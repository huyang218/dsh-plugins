import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as plugin from '../lib/index.js'

test('the host half exports the named shape a loader entry needs', () => {
  // A default export makes the loader drop the namespace, and `inject` then
  // silently does nothing — the failure surfaces somewhere else entirely.
  assert.equal('default' in plugin, false)
  assert.equal(plugin.name, 'shortcuts')
  assert.equal(typeof plugin.apply, 'function')
})

/**
 * Apply the plugin and hand back the deferred mount plus what it asked for.
 * @returns {{ services: string[], mount: Function }} The inject request
 */
function applyPlugin() {
  let services
  let mount
  plugin.apply({ inject: (names, callback) => { services = names; mount = callback } })
  return { services, mount }
}

test('the permission route waits for its services instead of probing once', () => {
  // A cold Desktop boot mounts the profile bundle before these host services
  // exist. A one-shot ctx.get() here reads undefined and skips the route for
  // the rest of the process; ctx.inject re-runs when the services arrive.
  const { services, mount } = applyPlugin()
  assert.deepEqual(services, ['webServer', 'permissionPresets', 'sessions'])
  assert.equal(typeof mount, 'function')
})

/**
 * Mount the host half against fakes and expose a request driver.
 * @returns {Object} The mounted route, its calls, and a request helper
 */
function mountRoute() {
  const session = { id: 'session-1' }
  const presetCalls = []
  let route
  let disposed = false
  let label
  let dispose

  applyPlugin().mount({
    sessions: { get: id => (id === session.id ? session : undefined) },
    permissionPresets: {
      set(target, preset) {
        if (preset === 'invalid') throw new Error('unknown preset')
        presetCalls.push([target, preset])
      },
    },
    webServer: {
      register(spec) {
        route = spec
        return () => { disposed = true }
      },
    },
    effect(callback, effectLabel) {
      label = effectLabel
      dispose = callback()
      return dispose
    },
  })

  const request = url => {
    let status
    let body
    route.handler({ url }, {
      writeHead(nextStatus) { status = nextStatus },
      end(nextBody) { body = JSON.parse(nextBody) },
    })
    return { status, body }
  }

  return { session, presetCalls, route, request, label, dispose, disposed: () => disposed }
}

test('the route registers under the plugin scope and is disposable', () => {
  const mounted = mountRoute()
  assert.equal(mounted.route.kind, 'prefix')
  assert.equal(mounted.route.path, '/dsh-shortcuts-permission')
  assert.match(mounted.label, /permission route/)

  mounted.dispose()
  assert.equal(mounted.disposed(), true, 'the route must come down with the plugin')
})

test('the route sets a permission only for a live session and a known preset', () => {
  const mounted = mountRoute()

  assert.equal(mounted.request('/dsh-shortcuts-permission').status, 400, 'no parameters')
  assert.equal(
    mounted.request('/dsh-shortcuts-permission?sessionId=missing&preset=read-only').status,
    404,
    'the session id is checked against the live store, not trusted',
  )
  assert.equal(
    mounted.request('/dsh-shortcuts-permission?sessionId=session-1&preset=invalid').status,
    400,
    'permissionPresets.set throws on an unknown preset and that must not 500',
  )
  assert.deepEqual(mounted.presetCalls, [], 'nothing was applied on any rejected request')

  const ok = mounted.request('/dsh-shortcuts-permission?sessionId=session-1&preset=read-only')
  assert.deepEqual(ok.body, { ok: true })
  assert.deepEqual(mounted.presetCalls, [[mounted.session, 'read-only']])
})
