import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as plugin from '../lib/index.js'

/**
 * A context recording what the plugin registers. No channel is enabled in most
 * of these, because enabling one opens a real socket to a real platform.
 * @returns {Object} the fake context and what it captured
 */
function fakeContext() {
  const warnings = []
  const infos = []
  const routes = []
  const effects = []
  const ctx = {
    agents: {},
    sessions: {},
    webServer: { register: spec => { routes.push(spec); return () => {} } },
    logger: { warn: message => warnings.push(message), info: message => infos.push(message) },
    on: () => () => {},
    effect: fn => { effects.push(fn) },
    inject: () => {},
    get: () => undefined,
  }
  return { ctx, warnings, infos, routes, effects }
}

test('the plugin exports the named shape a loader entry needs', () => {
  // A default export makes the loader drop the namespace, and `inject` then
  // silently does nothing.
  assert.equal('default' in plugin, false)
  assert.equal(plugin.name, 'im')
  assert.equal(typeof plugin.apply, 'function')
  assert.deepEqual(plugin.inject, ['agents', 'sessions', 'webServer'])
})

test('nobody is allowed and no channel is on, by default', () => {
  const config = new plugin.Config()
  assert.deepEqual(config.allowFrom, [], 'an empty allowlist admits nobody')
  for (const channel of ['lark', 'wecom', 'dingtalk', 'qq']) {
    assert.equal(config[channel].enabled, false, `${channel} must not be on until it is configured`)
  }
  assert.equal(config.refusalNotice, '', 'silence towards strangers is the default')
})

test('with no channel enabled it says so and registers nothing', () => {
  const { ctx, warnings, routes } = fakeContext()
  plugin.apply(ctx, new plugin.Config())

  assert.deepEqual(routes, [])
  assert.ok(warnings.some(message => message.includes('no channel is enabled')),
    '"the plugin does nothing" has to be answerable from the log')
})

test('an enabled channel with an empty allowlist is warned about loudly', () => {
  // This is the state where every message is refused and the reason is a config
  // field nobody remembers leaving empty. Enabling a callback channel is safe
  // here: it registers a route, it does not dial out.
  const { ctx, warnings, routes } = fakeContext()
  plugin.apply(ctx, new plugin.Config({
    lark: { enabled: true, appId: 'a', appSecret: 's', verificationToken: 't', path: '/im/lark' },
  }))

  assert.equal(routes.length, 1)
  assert.equal(routes[0].path, '/im/lark')
  assert.ok(warnings.some(message => message.includes('allowFrom is empty')))
})

test('apply completes with a channel enabled — the wiring order holds', () => {
  // Regression: the message handler used to be declared after the call that
  // assigns it, so apply() threw on the first channel. A plugin that throws in
  // apply takes its whole entry down at startup, and the stack points at a
  // temporal dead zone rather than at the ordering that caused it.
  const { ctx, infos } = fakeContext()
  assert.doesNotThrow(() => plugin.apply(ctx, new plugin.Config({
    allowFrom: ['ou_me'],
    wecom: { enabled: true, corpId: 'c', corpSecret: 's', agentId: 1, token: 't', encodingAesKey: 'k', path: '/im/wecom' },
  })))
  assert.ok(infos.some(message => message.includes('/im/wecom')))
})

test('a callback channel says it needs a public address, a socket channel says it does not', () => {
  // Which of the two a channel is decides whether a deployment behind NAT can
  // use it at all, so it is stated at startup rather than discovered later.
  const callback = fakeContext()
  plugin.apply(callback.ctx, new plugin.Config({
    allowFrom: ['x'],
    lark: { enabled: true, appId: 'a', appSecret: 's', verificationToken: 't', path: '/im/lark' },
  }))
  assert.ok(callback.infos.some(message => message.includes('reachable from the internet')))
})
