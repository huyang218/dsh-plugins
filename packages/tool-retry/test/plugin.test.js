import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as plugin from '../lib/index.js'

function wrapperOf(config) {
  const listeners = {}
  plugin.apply({ on: (event, fn) => { (listeners[event] ??= []).push(fn) }, tools: { register: () => assert.fail('registers no tools') } },
    new plugin.Config(config))
  return listeners['tools/execute'][0]
}

const ok = { isError: false, value: 1, content: [] }
const transient = { isError: true, error: { message: 'fetch failed' }, content: [{ type: 'text', text: 'fetch failed' }] }
const permanent = { isError: true, error: { message: '积分不足' }, content: [{ type: 'text', text: '积分不足' }] }

/** A dispatch that fails `failures` times, then succeeds. */
function flaky(failures, outcome = transient) {
  let calls = 0
  const next = async () => {
    calls += 1
    return calls <= failures ? outcome : ok
  }
  return { next, calls: () => calls }
}

test('exports the named plugin surface and no default export', () => {
  assert.ok(!('default' in plugin))
  assert.equal(plugin.name, 'tool-retry')
  assert.ok(!plugin.name.startsWith('dsh-plugin-'))
  assert.deepEqual(plugin.inject, ['tools'])
})

test('a declared tool failing transiently is retried until it works', async () => {
  const wrapper = wrapperOf({ retryTools: ['astock_*'], backoffMs: 0 })
  const dispatch = flaky(2)
  const result = await wrapper({ name: 'astock_quote' }, dispatch.next)
  assert.equal(result, ok)
  assert.equal(dispatch.calls(), 3, 'two failures, then the successful attempt')
})

test('an undeclared tool is never repeated, however transient the failure', async () => {
  // The whole safety of this plugin is here: a tool that wrote something would
  // otherwise write it twice.
  const wrapper = wrapperOf({ retryTools: ['astock_*'], backoffMs: 0 })
  const dispatch = flaky(2)
  const result = await wrapper({ name: 'write' }, dispatch.next)
  assert.equal(result, transient)
  assert.equal(dispatch.calls(), 1)
})

test('a permanent failure is returned immediately and untouched', async () => {
  const wrapper = wrapperOf({ retryTools: ['astock_*'], backoffMs: 0 })
  const dispatch = flaky(5, permanent)
  const result = await wrapper({ name: 'astock_financials' }, dispatch.next)
  assert.equal(result, permanent, 'the exact result object passes through')
  assert.equal(dispatch.calls(), 1)
})

test('an exhausted retry says so, so the model does not read it as one fluke', async () => {
  const wrapper = wrapperOf({ retryTools: ['astock_*'], maxAttempts: 3, backoffMs: 0 })
  const dispatch = flaky(99)
  const result = await wrapper({ name: 'astock_quote' }, dispatch.next)
  assert.equal(dispatch.calls(), 3)
  assert.equal(result.isError, true, 'a failure stays a failure — never a fake success')
  assert.match(result.content.at(-1).text, /已重试 2 次/)
  assert.match(result.content.at(-1).text, /不是偶发抖动/)
})

test('a thrown dispatch retries too, and the throw still propagates when it will not clear', async () => {
  const wrapper = wrapperOf({ retryTools: ['astock_*'], maxAttempts: 2, backoffMs: 0 })
  let calls = 0
  await assert.rejects(
    () => wrapper({ name: 'astock_quote' }, async () => { calls += 1; throw new Error('ECONNRESET') }),
    error => {
      assert.match(error.message, /ECONNRESET/)
      assert.match(error.message, /已重试 1 次/)
      return true
    },
  )
  assert.equal(calls, 2)
})

test('a retry runs under a deadline of its own', async () => {
  // cordis consumes its waterfall listener list, so a repeated next() reaches
  // the tool body directly and skips every wrapper already shifted off — the
  // official timeout policy included. Without this the retry would be the one
  // attempt nobody can stop.
  const wrapper = wrapperOf({ retryTools: ['astock_*'], backoffMs: 0, retryDeadlineMs: 50 })
  const seen = []
  const original = AbortSignal.timeout(60_000)
  const exec = { name: 'astock_quote', signal: original }
  let calls = 0
  await wrapper(exec, async () => {
    calls += 1
    seen.push(exec.signal)
    return calls === 1 ? transient : ok
  })
  assert.equal(seen[0], original, 'the first attempt keeps the caller signal untouched')
  assert.notEqual(seen[1], original, 'the retry gets a fused signal carrying a deadline')
  assert.equal(exec.signal, original, 'and the caller signal is restored afterwards')
})

test('cancellation during the backoff returns the failure instead of trying again', async () => {
  const wrapper = wrapperOf({ retryTools: ['astock_*'], backoffMs: 10_000 })
  const controller = new AbortController()
  const dispatch = flaky(99)
  const pending = wrapper({ name: 'astock_quote', signal: controller.signal }, dispatch.next)
  controller.abort()
  const result = await pending
  assert.equal(result, transient)
  assert.equal(dispatch.calls(), 1, 'no attempt is started that nobody is waiting for')
})
