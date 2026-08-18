import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as plugin from '../lib/index.js'

function fakeCtx() {
  const listeners = {}
  const contexts = []
  const provided = {}
  const disposers = []
  const logged = []
  return {
    on: (event, fn) => { (listeners[event] ??= []).push(fn) },
    systemPrompt: { context: c => contexts.push(c) },
    tools: { register: () => assert.fail('this plugin must register no tools') },
    provide: (key, value) => { provided[key] = value },
    effect: fn => { disposers.push(fn()) },
    logger: { info: line => logged.push(line) },
    _listeners: listeners, _contexts: contexts, _provided: provided,
    _disposers: disposers, _logged: logged,
  }
}

const ok = { isError: false, value: 1, content: [] }
const failed = { isError: true, error: { message: 'boom' }, content: [] }

/** Run one dispatch through the wrapper, taking `ms` and yielding `result`. */
async function dispatch(wrapper, name, ms, result = ok) {
  return wrapper({ name }, async () => {
    await new Promise(resolve => setTimeout(resolve, ms))
    if (result instanceof Error) throw result
    return result
  })
}

test('exports the named plugin surface and no default export', () => {
  assert.ok(!('default' in plugin))
  assert.equal(plugin.name, 'tool-usage')
  assert.ok(!plugin.name.startsWith('dsh-plugin-'))
  assert.deepEqual(plugin.inject, ['systemPrompt'])
})

test('it wraps dispatch, forwards the result unchanged, and registers no tools', async () => {
  const ctx = fakeCtx()
  plugin.apply(ctx, new plugin.Config())
  const wrapper = ctx._listeners['tools/execute'][0]

  const sentinel = { isError: false, value: { deep: true }, content: [] }
  const returned = await wrapper({ name: 't' }, async () => sentinel)
  // A metrics wrapper that alters the result is a bug, not a metric.
  assert.equal(returned, sentinel, 'the exact result object must pass through')
  assert.equal(ctx._provided.toolUsage.snapshot().calls, 1)
})

test('a thrown dispatch is still measured, and the throw still propagates', async () => {
  const ctx = fakeCtx()
  plugin.apply(ctx, new plugin.Config())
  const wrapper = ctx._listeners['tools/execute'][0]

  await assert.rejects(() => dispatch(wrapper, 'explodes', 5, new Error('kaboom')), /kaboom/)
  const snapshot = ctx._provided.toolUsage.snapshot()
  // A call that blew up spent its time too; dropping it would make the worst
  // tool in a bad session look like the cheapest.
  assert.equal(snapshot.calls, 1)
  assert.equal(snapshot.failures, 1)
})

test('failures and durations land per tool', async () => {
  const ctx = fakeCtx()
  plugin.apply(ctx, new plugin.Config())
  const wrapper = ctx._listeners['tools/execute'][0]

  await dispatch(wrapper, 'slow', 30)
  await dispatch(wrapper, 'fast', 1)
  await dispatch(wrapper, 'fast', 1, failed)

  const snapshot = ctx._provided.toolUsage.snapshot()
  assert.equal(snapshot.calls, 3)
  assert.equal(snapshot.failures, 1)
  assert.equal(snapshot.tools[0].name, 'slow', 'sorted by time spent')
  const fast = snapshot.tools.find(t => t.name === 'fast')
  assert.equal(fast.calls, 2)
  assert.equal(fast.failures, 1)
})

test('an unnamed dispatch is still accounted for, under a visible label', async () => {
  const ctx = fakeCtx()
  plugin.apply(ctx, new plugin.Config())
  await ctx._listeners['tools/execute'][0]({}, async () => ok)
  assert.equal(ctx._provided.toolUsage.snapshot().tools[0].name, '(unknown)')
})

test('the budget context is silent by default and speaks once crossed', async () => {
  const ctx = fakeCtx()
  plugin.apply(ctx, new plugin.Config({ budgetCalls: 2 }))
  const wrapper = ctx._listeners['tools/execute'][0]
  const warning = ctx._contexts[0].text

  await dispatch(wrapper, 'x', 1)
  assert.equal(warning(), '', 'an ordinary session pays nothing for this plugin')
  await dispatch(wrapper, 'x', 1)
  assert.match(warning(), /2 tool calls/)
})

test('the service exposes a report and can be reset', async () => {
  const ctx = fakeCtx()
  plugin.apply(ctx, new plugin.Config())
  await dispatch(ctx._listeners['tools/execute'][0], 'x', 2)
  const usage = ctx._provided.toolUsage
  assert.match(usage.report(), /Tool usage: 1 calls/)
  usage.reset()
  assert.equal(usage.snapshot().calls, 0)
  assert.equal(usage.report(), 'No tool calls yet.')
})

test('disposing logs the summary once, and never when nothing ran', async () => {
  const ctx = fakeCtx()
  plugin.apply(ctx, new plugin.Config())
  await dispatch(ctx._listeners['tools/execute'][0], 'x', 1)
  ctx._disposers.forEach(dispose => dispose())
  assert.equal(ctx._logged.length, 1)
  assert.match(ctx._logged[0], /Tool usage: 1 calls/)

  const quiet = fakeCtx()
  plugin.apply(quiet, new plugin.Config())
  quiet._disposers.forEach(dispose => dispose())
  assert.equal(quiet._logged.length, 0, 'a session that called nothing logs nothing')
})

test('the wrapper marks run_code sub-dispatches as nested', async () => {
  const ctx = fakeCtx()
  plugin.apply(ctx, new plugin.Config())
  const wrapper = ctx._listeners['tools/execute'][0]

  await wrapper({ name: 'run_code' }, async () => {
    await dispatch(wrapper, 'inner', 5)          // no parent → would be counted twice
    await wrapper({ name: 'inner2', parent: 'tok' }, async () => ok)
    return ok
  })
  const snapshot = ctx._provided.toolUsage.snapshot()
  assert.equal(snapshot.nestedCalls, 1, 'only the call carrying a parent token is nested')
  const inner2 = snapshot.tools.find(t => t.name === 'inner2')
  assert.equal(inner2.nestedCalls, 1)
})
