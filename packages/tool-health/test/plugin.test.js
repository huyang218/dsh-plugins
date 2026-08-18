import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as plugin from '../lib/index.js'

/** Fake ctx capturing listeners, prompt contexts and nested injections. */
function fakeCtx(services = {}) {
  const listeners = {}
  const contexts = []
  const effects = []
  const ctx = {
    on: (event, fn) => { (listeners[event] ??= []).push(fn) },
    systemPrompt: { context: c => contexts.push(c) },
    tools: { register: () => assert.fail('this plugin must register no tools') },
    effect: (fn, label) => { effects.push({ label, dispose: fn() }) },
    inject: (names, body) => {
      if (names.every(n => services[n] !== undefined)) body({ ...ctx, ...services })
    },
    _listeners: listeners, _contexts: contexts, _effects: effects,
  }
  return ctx
}

const success = { isError: false, value: 1, content: [] }
const failure = (message, code) => ({
  isError: true, error: { code, message }, content: [{ type: 'text', text: message }],
})

test('exports the named plugin surface and no default export', () => {
  assert.ok(!('default' in plugin))
  assert.equal(plugin.name, 'tool-health')
  assert.ok(!plugin.name.startsWith('dsh-plugin-'))
  assert.deepEqual(plugin.inject, ['systemPrompt'])
})

test('it observes results and registers no tools', () => {
  const ctx = fakeCtx()
  plugin.apply(ctx, new plugin.Config())
  // tools/result is emit-mode: an observer here cannot alter a tool's result,
  // which is exactly why the health record belongs on this event.
  assert.equal(ctx._listeners['tools/result']?.length, 1)
  assert.equal(ctx._contexts.length, 1)
  assert.equal(ctx._contexts[0].name, 'tool-health:recent-failures')
})

test('the prompt context reflects failures observed in THIS session', () => {
  const ctx = fakeCtx()
  plugin.apply(ctx, new plugin.Config({ unhealthyAfter: 2 }))
  const observe = ctx._listeners['tools/result'][0]
  const report = ctx._contexts[0].text

  assert.equal(report(), '', 'nothing has failed yet')

  observe({ name: 'astock_market_quotes' }, failure('fetch failed', 'UND_ERR_SOCKET'))
  assert.equal(report(), '', 'one failure is noise')

  observe({ name: 'astock_market_quotes' }, failure('fetch failed', 'UND_ERR_SOCKET'))
  const text = report()
  assert.match(text, /astock_market_quotes/)
  assert.match(text, /UND_ERR_SOCKET/)

  // Text is a function, not a snapshot: a recovery must clear the warning
  // without the plugin re-registering anything.
  observe({ name: 'astock_market_quotes' }, success)
  assert.equal(report(), '', 'a success clears the report')
})

test('results without a usable tool name are ignored', () => {
  const ctx = fakeCtx()
  plugin.apply(ctx, new plugin.Config({ unhealthyAfter: 1 }))
  const observe = ctx._listeners['tools/result'][0]
  observe({}, failure('x'))
  observe({ name: '' }, failure('x'))
  observe(undefined, failure('x'))
  assert.equal(ctx._contexts[0].text(), '')
})

test('failureText prefers the structured error over rendered content', () => {
  assert.equal(plugin.failureText(failure('quota exceeded', 'RATE_LIMIT')), 'RATE_LIMIT: quota exceeded')
  assert.equal(plugin.failureText({ isError: true, error: { message: 'plain' }, content: [] }), 'plain')
  assert.equal(
    plugin.failureText({ isError: true, error: {}, content: [{ type: 'text', text: 'from content' }] }),
    'from content',
  )
  assert.equal(plugin.failureText({ isError: true, error: {}, content: [] }), 'unknown error')
})

test('evict drops the least recently touched tools first', () => {
  const records = new Map([
    ['old', { lastFailAt: 100 }],
    ['newer', { lastOkAt: 300 }],
    ['newest', { lastFailAt: 500 }],
  ])
  plugin.evict(records, 2)
  assert.deepEqual([...records.keys()], ['newer', 'newest'])
  plugin.evict(records, 5)
  assert.equal(records.size, 2, 'a store under the bound is left alone')
})

test('records survive a restart through the storage domain', async () => {
  const stored = new Map()
  const table = {
    entries: () => stored.entries(),
    put: async (key, value) => { stored.set(key, value) },
  }
  const domain = { table: () => table, close: async () => {} }
  const storageDomain = { open: async () => domain }

  // First session: two failures are observed and written through.
  const first = fakeCtx({ storageDomain })
  plugin.apply(first, new plugin.Config({ unhealthyAfter: 2 }))
  const observe = first._listeners['tools/result'][0]
  await Promise.resolve()
  observe({ name: 'astock_financials' }, failure('积分不足', 'ACCESS'))
  observe({ name: 'astock_financials' }, failure('积分不足', 'ACCESS'))
  await new Promise(resolve => setTimeout(resolve, 10))
  assert.equal(stored.get('astock_financials').streak, 2, 'the record reached storage')

  // Second session: the warning is available before any call is made.
  const second = fakeCtx({ storageDomain })
  plugin.apply(second, new plugin.Config({ unhealthyAfter: 2 }))
  await new Promise(resolve => setTimeout(resolve, 10))
  const text = second._contexts[0].text()
  assert.match(text, /astock_financials/, 'the next session starts already knowing')
  assert.match(text, /积分不足/)
})

test('without a storage backend the observer still works for this session', () => {
  const ctx = fakeCtx()          // no storageDomain service
  plugin.apply(ctx, new plugin.Config({ unhealthyAfter: 1 }))
  assert.equal(ctx._effects.length, 0, 'nothing is scheduled when storage is absent')
  ctx._listeners['tools/result'][0]({ name: 'x' }, failure('boom'))
  assert.match(ctx._contexts[0].text(), /x/, 'refusing to load would be worse than not persisting')
})
