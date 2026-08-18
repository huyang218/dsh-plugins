import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * Load the SHIPPED client bundle by standing in for the browser: the loader
 * table, React and the DOM globals are what the host provides, so faking that
 * set runs the real artifact. The bundle reads localStorage and
 * navigator.platform while the factory runs, not inside apply().
 * @returns {Promise<Object>} The bundle's exports
 */
async function loadBundle() {
  let captured
  const noop = () => {}
  // Node ships its own getter-only `navigator`, so plain assignment throws.
  Object.defineProperty(globalThis, 'navigator', {
    value: { platform: 'MacIntel', userAgent: 'node' },
    configurable: true,
  })
  globalThis.document = { createElement: () => ({ setAttribute: noop, remove: noop }), head: { append: noop } }
  globalThis.window = {
    localStorage: { getItem: () => null, setItem: noop },
    addEventListener: noop,
    removeEventListener: noop,
    setTimeout: noop,
    __ModuleLoader__: {
      load: ({ id, factory }) => {
        // The host serves the bundle under the package name and registers it
        // by that id; a stale id here loads nothing and looks like a plugin
        // that was never installed.
        assert.equal(id, 'dsh-plugin-shortcuts', 'the loader id must match the package name')
        captured = factory(name => {
          if (name === 'react') return { createElement: (type, props, ...children) => ({ type, props, children }) }
          throw new Error(`unexpected external ${name}`)
        })
      },
    },
  }
  await import('../lib/client.js')
  return captured
}

const bundle = await loadBundle()

test('the bundle registers itself in the loader factory form', () => {
  assert.equal(typeof bundle.apply, 'function')
  assert.deepEqual(bundle.inject, ['slots', 'sessions', 'remote', 'timer'])
})

/** Services resolved while apply() runs, as opposed to when a key is pressed. */
function servicesResolvedDuringApply() {
  const asked = []
  bundle.apply({
    get: name => { asked.push(name); return undefined },
    effect: callback => callback(),
    timeout: () => {},
  })
  return [...new Set(asked)]
}

test('what apply() needs at once is declared, so it is not mounted too early', () => {
  // These are read while the plugin mounts. `ctx.get` returns undefined for a
  // service that is not up yet — it does not throw — so an undeclared one
  // here does not fail loudly: the effect just wires nothing and the
  // shortcuts stay dead until a manual reload.
  const undeclared = servicesResolvedDuringApply().filter(name => !bundle.inject.includes(name))
  assert.deepEqual(undeclared, [], `apply() resolves undeclared services: ${undeclared}`)
})

test('services only an action needs stay out of inject, on purpose', () => {
  // inject decides WHEN apply runs, and it waits for every name in the list.
  // Theme, workspaces or locale are each used by one or two features, so
  // declaring them would trade "language cycling does nothing on a
  // deployment without the locale service" for "no shortcut works at all
  // there". Reading them lazily is what makes the degradation partial.
  const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  const resolved = [...new Set([...source.matchAll(/\.get\('([a-zA-Z.]+)'\)/g)].map(match => match[1]))]
  const duringApply = servicesResolvedDuringApply()
  const lazy = resolved.filter(name => !duringApply.includes(name))

  assert.ok(lazy.length > 0, 'the lazy set is what this test is about')
  const declared = lazy.filter(name => bundle.inject.includes(name.split('.')[0]))
  assert.deepEqual(
    declared.filter(name => name !== 'remote.commands'),
    [],
    'a per-feature service was added to inject, which gates the whole plugin on it',
  )
})

test('a combo needs a modifier and a real key', () => {
  assert.deepEqual(bundle.parseCombo('Meta+K'), { mods: new Set(['Meta']), key: 'K' })
  assert.equal(bundle.parseCombo('K'), null, 'a bare key would swallow ordinary typing')
  assert.equal(bundle.parseCombo('Meta'), null, 'a modifier alone is not a binding')
  assert.equal(bundle.parseCombo('Hyper+K'), null, 'an unknown modifier is not silently ignored')
  assert.equal(bundle.parseCombo(''), null)
  assert.equal(bundle.parseCombo(undefined), null)
})

test('matching is exact on every modifier, not just the ones the combo names', () => {
  const event = { key: 'k', metaKey: true, ctrlKey: false, altKey: false, shiftKey: false }
  assert.equal(bundle.matchCombo('Meta+K', event), true)
  // Without this, ⌘⇧K would also fire ⌘K and one press runs two actions.
  assert.equal(bundle.matchCombo('Meta+K', { ...event, shiftKey: true }), false)
  assert.equal(bundle.matchCombo('Control+K', event), false)
  assert.equal(bundle.matchCombo('Meta+Shift+K', { ...event, shiftKey: true }), true)
})

test('a shifted character maps back to the key printed on the keyboard', () => {
  // The browser reports ⌘⇧/ as key '?', which no one would bind by that name.
  assert.equal(bundle.comboFromEvent({ key: '?', metaKey: true, shiftKey: true, ctrlKey: false, altKey: false }), 'Meta+Shift+/')
  assert.equal(bundle.comboFromEvent({ key: 'k', metaKey: false, ctrlKey: false, altKey: false, shiftKey: false }), null, 'no modifier, no combo')
  assert.equal(bundle.comboFromEvent({ key: 'Meta', metaKey: true, ctrlKey: false, altKey: false, shiftKey: false }), null, 'holding a modifier alone is not a combo')
})

test('combos are displayed with the symbols the keyboard shows', () => {
  assert.equal(bundle.formatCombo('Meta+Shift+K'), '⌘ ⇧ K')
  assert.equal(bundle.formatCombo('Control+Escape'), '⌃ Esc')
  assert.equal(bundle.formatCombo(null), null)
  assert.equal(bundle.formatCombo('nonsense'), null, 'an unparseable binding has no display form')
})

test('typing targets are recognised so bindings do not eat text', () => {
  assert.equal(bundle.isEditable({ tagName: 'INPUT' }), true)
  assert.equal(bundle.isEditable({ tagName: 'TEXTAREA' }), true)
  assert.equal(bundle.isEditable({ tagName: 'DIV', isContentEditable: true }), true)
  assert.equal(bundle.isEditable({ tagName: 'DIV' }), false)
  assert.equal(bundle.isEditable(null), false)
})

test('stored settings are rebuilt onto the current feature list', () => {
  const base = bundle.defaults()
  assert.deepEqual(Object.keys(base.actions).sort(), bundle.FEATURES.map(f => f.id).sort())

  // A feature added by an upgrade must appear for a user whose stored
  // settings predate it, rather than staying missing until they clear
  // localStorage.
  const restored = bundle.normalize({ actions: { [bundle.FEATURES[0].id]: { enabled: false, combo: 'Meta+J' } } })
  assert.deepEqual(Object.keys(restored.actions).sort(), Object.keys(base.actions).sort())
  assert.deepEqual(restored.actions[bundle.FEATURES[0].id], { enabled: false, combo: 'Meta+J' })

  // A binding that no longer parses is dropped to unbound, not carried
  // forward as a combo that can never fire.
  const broken = bundle.normalize({ actions: { [bundle.FEATURES[0].id]: { combo: 'Hyper+K' } } })
  assert.deepEqual(broken.actions[bundle.FEATURES[0].id], { enabled: true, combo: null })

  assert.deepEqual(bundle.normalize(null), base)
  assert.deepEqual(bundle.normalize('nonsense'), base)
})
