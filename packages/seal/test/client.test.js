import { test } from 'node:test'
import assert from 'node:assert/strict'

/**
 * Load the SHIPPED client bundle by standing in for the browser. Testing a copy
 * of the logic would not prove the file we publish behaves this way.
 * @returns {Promise<Object>} the bundle's exports
 */
async function loadBundle() {
  let captured
  const noop = () => {}
  globalThis.document = { createElement: () => ({ setAttribute: noop, remove: noop }), head: { append: noop } }
  globalThis.window = {
    __ModuleLoader__: {
      load: ({ id, factory }) => {
        // The host serves the bundle under the package name and registers it by
        // that id; a stale id looks exactly like a plugin that was never
        // installed.
        assert.equal(id, 'dsh-plugin-seal')
        captured = factory(name => {
          if (name === 'react') {
            return {
              createElement: (type, props, ...children) => ({ type, props, children }),
              useState: value => [value, () => {}],
              useEffect: () => {},
              useCallback: fn => fn,
            }
          }
          throw new Error(`unexpected external ${name}`)
        })
      },
    },
  }
  await import('../client/client.js')
  return captured
}

const bundle = await loadBundle()

test('the bundle registers itself in the loader factory form', () => {
  assert.equal(typeof bundle.apply, 'function')
  assert.deepEqual(bundle.inject, ['slots'])
})

test('every service apply() touches is declared', () => {
  // Cordis refuses an undeclared property, and the cost is not a missing form:
  // the entry fails to apply and the browser shows "Failed to load plugins".
  const read = []
  const probe = new Proxy({}, {
    get: (_target, key) => {
      if (typeof key === 'string') read.push(key)
      return new Proxy(() => {}, { get: () => () => {}, apply: () => {} })
    },
  })
  bundle.apply(probe)
  const undeclared = [...new Set(read)].filter(key => !bundle.inject.includes(key) && key !== 'effect')
  assert.deepEqual(undeclared, [])
})

test('the settings page never puts a passphrase on screen', () => {
  // The page is told whether one is held, never what it is.
  const configured = bundle.summarise({ p12Path: '/keys/company.p12', hasPassphrase: true, durable: true })
  assert.match(configured, /\/keys\/company\.p12/)
  assert.match(configured, /已保存/)

  assert.match(bundle.summarise(null), /尚未配置/)
  assert.match(bundle.summarise({ p12Path: '/k/c.p12', hasPassphrase: false, durable: true }), /未设置/)
  // No storage backend is worth saying: the credential would be forgotten.
  assert.match(bundle.summarise({ p12Path: '/k/c.p12', hasPassphrase: true, durable: false }), /重启后会忘记/)
})
