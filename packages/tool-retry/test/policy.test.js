import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isRepeatable, isTransient, backoffFor, failureOf, decide, exhaustedNote } from '../lib/policy.js'

test('isRepeatable matches literal names and a trailing-star prefix only', () => {
  assert.equal(isRepeatable('astock_quote', ['astock_quote']), true)
  assert.equal(isRepeatable('astock_quote', ['astock_*']), true)
  assert.equal(isRepeatable('write', ['astock_*']), false)
  // Deliberately not regular expressions: this list decides what may run
  // twice, and a stray `.` matching everything is not a mistake worth enabling.
  assert.equal(isRepeatable('write', ['.*']), false)
  assert.equal(isRepeatable('anything', []), false)
  assert.equal(isRepeatable('anything', undefined), false)
})

test('isTransient recognises the failures that might clear, and only those', () => {
  for (const message of [
    'fetch failed', 'UND_ERR_SOCKET', 'ECONNRESET', 'socket hang up',
    'HTTP 503', 'rate limit exceeded', '抱歉，您访问接口(daily)频率超限', 'request timed out', '请求超时',
  ]) {
    assert.equal(isTransient(message), true, `${message} should be transient`)
  }
  for (const message of [
    'Unknown report "nope"', 'permission denied', '积分不足', 'no such file',
    'is not a six-digit A-share code', 'additionalProperties must be explicitly true or false',
  ]) {
    assert.equal(isTransient(message), false, `${message} will fail identically forever`)
  }
})

test('backoff grows and then stops growing', () => {
  const options = { backoffMs: 500, maxBackoffMs: 4000 }
  assert.deepEqual([1, 2, 3, 4, 9].map(a => backoffFor(a, options)), [500, 1000, 2000, 4000, 4000])
})

test('failureOf reads a thrown error, a structured failure, or the rendered text', () => {
  assert.equal(failureOf({ error: new Error('boom') }), 'boom')
  assert.equal(failureOf({ result: { isError: true, error: { code: 'RATE_LIMIT', message: 'slow down' } } }), 'RATE_LIMIT slow down')
  assert.equal(failureOf({ result: { isError: true, error: {}, content: [{ type: 'text', text: 'fetch failed' }] } }), 'fetch failed')
  assert.equal(failureOf({ result: { isError: false, value: 1 } }), undefined, 'a success is not a failure')
})

test('decide retries only a declared tool failing transiently, within the attempt budget', () => {
  const config = { retryTools: ['astock_*'], maxAttempts: 3 }
  const transient = { result: { isError: true, error: { message: 'fetch failed' } } }

  assert.equal(decide({ toolName: 'astock_quote', outcome: transient, attempt: 1, config }).retry, true)

  // The dangerous half: an undeclared tool is never repeated, however
  // transient the failure looks — it may have written something already.
  assert.deepEqual(
    decide({ toolName: 'write', outcome: transient, attempt: 1, config }),
    { retry: false, reason: 'not-declared-repeatable', failure: 'fetch failed' },
  )

  const permanent = { result: { isError: true, error: { message: '积分不足' } } }
  assert.equal(decide({ toolName: 'astock_quote', outcome: permanent, attempt: 1, config }).reason, 'not-transient')

  assert.equal(decide({ toolName: 'astock_quote', outcome: transient, attempt: 3, config }).reason, 'attempts-exhausted')
  assert.equal(decide({ toolName: 'astock_quote', outcome: { result: { isError: false } }, attempt: 1, config }).reason, 'succeeded')
})

test('nothing is repeatable until an operator says so', () => {
  // The shipped default has to be safe in a deployment nobody configured.
  const decision = decide({
    toolName: 'astock_quote',
    outcome: { result: { isError: true, error: { message: 'fetch failed' } } },
    attempt: 1,
    config: {},
  })
  assert.equal(decision.retry, false)
  assert.equal(decision.reason, 'not-declared-repeatable')
})

test('the exhausted note tells the model this was not one unlucky call', () => {
  const note = exhaustedNote(3, 'astock_quote')
  assert.match(note, /重试 2 次/)
  assert.match(note, /不是偶发抖动/)
  assert.match(note, /如实报告/)
})
