import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as plugin from '../lib/index.js'

/** Capture the llm/stream waterfall listener that apply registers. */
function captureListener() {
  let listener
  plugin.apply({ on: (event, fn) => { assert.equal(event, 'llm/stream'); listener = fn } })
  assert.equal(typeof listener, 'function')
  return listener
}

async function* streamOf(chunks) {
  yield* chunks
}

async function collect(listener, chunks) {
  const out = []
  for await (const chunk of listener({}, () => streamOf(chunks))) out.push(chunk)
  return out
}

const streamClosed = { type: 'finish', reason: { kind: 'error', failure: { code: 'STREAM_CLOSED' } } }

test('exports the named plugin surface and no default export', () => {
  assert.ok(!('default' in plugin), 'default export would make the Loader drop the namespace')
  assert.equal(plugin.name, 'gateway-compat')
  assert.equal(typeof plugin.apply, 'function')
})

test('rewrites STREAM_CLOSED to stop after plain content', async () => {
  const listener = captureListener()
  const out = await collect(listener, [{ type: 'text-delta', text: 'hi' }, streamClosed])
  assert.deepEqual(out, [
    { type: 'text-delta', text: 'hi' },
    { type: 'finish', reason: { kind: 'stop' } },
  ])
})

test('rewrites STREAM_CLOSED after reasoning-only content', async () => {
  const listener = captureListener()
  const out = await collect(listener, [{ type: 'reasoning-delta', text: 'mm' }, streamClosed])
  assert.deepEqual(out.at(-1), { type: 'finish', reason: { kind: 'stop' } })
})

test('keeps STREAM_CLOSED failing when no content arrived', async () => {
  const listener = captureListener()
  const out = await collect(listener, [streamClosed])
  assert.deepEqual(out, [streamClosed])
})

test('keeps STREAM_CLOSED failing when a tool call was in flight', async () => {
  const listener = captureListener()
  const chunks = [
    { type: 'text-delta', text: 'hi' },
    { type: 'tool-call-delta', name: 'x' },
    streamClosed,
  ]
  const out = await collect(listener, chunks)
  assert.deepEqual(out, chunks)
})

test('passes other errors and normal finishes through untouched', async () => {
  const listener = captureListener()
  const other = { type: 'finish', reason: { kind: 'error', failure: { code: 'RATE_LIMITED' } } }
  assert.deepEqual(await collect(listener, [{ type: 'text-delta', text: 'a' }, other]),
    [{ type: 'text-delta', text: 'a' }, other])
  const stop = { type: 'finish', reason: { kind: 'stop' } }
  assert.deepEqual(await collect(listener, [{ type: 'text-delta', text: 'a' }, stop]),
    [{ type: 'text-delta', text: 'a' }, stop])
})
