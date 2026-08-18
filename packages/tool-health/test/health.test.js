import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fold, isUnhealthy, ago, renderReport } from '../lib/health.js'

const MINUTE = 60_000
const HOUR = 3_600_000
const opts = { unhealthyAfter: 2, staleMs: 24 * HOUR }

test('fold counts calls, and a success resets the streak and clears the error', () => {
  let record = fold(undefined, { ok: false, at: 1000, error: 'boom' })
  assert.deepEqual(record, { calls: 1, failures: 1, streak: 1, lastFailAt: 1000, lastError: 'boom' })

  record = fold(record, { ok: false, at: 2000, error: 'boom again' })
  assert.equal(record.streak, 2)
  assert.equal(record.lastError, 'boom again')

  record = fold(record, { ok: true, at: 3000 })
  assert.equal(record.streak, 0, 'a success ends the streak')
  assert.equal(record.lastOkAt, 3000)
  assert.ok(!('lastError' in record), 'a recovered tool carries no stale error')
  assert.equal(record.calls, 3)
  assert.equal(record.failures, 2, 'the historical failure count is kept')
})

test('fold bounds the stored error text', () => {
  const record = fold(undefined, { ok: false, at: 1, error: 'x'.repeat(1000) })
  assert.equal(record.lastError.length, 300)
})

test('isUnhealthy needs a streak, recency, and no success since the failure', () => {
  const now = 10 * HOUR
  const failing = { calls: 5, failures: 3, streak: 3, lastFailAt: now - MINUTE }
  assert.equal(isUnhealthy(failing, { now, ...opts }), true)

  // One failure is noise, not an outage.
  assert.equal(isUnhealthy({ ...failing, streak: 1 }, { now, ...opts }), false)

  // A week-old outage says nothing about this session; warning about it would
  // teach the model to avoid a tool that now works.
  const old = { ...failing, lastFailAt: now - 48 * HOUR }
  assert.equal(isUnhealthy(old, { now, ...opts }), false)

  // A success AFTER the last failure clears it whatever the streak says.
  const recovered = { ...failing, lastOkAt: now - 30_000 }
  assert.equal(isUnhealthy(recovered, { now, ...opts }), false)

  assert.equal(isUnhealthy(undefined, { now, ...opts }), false)
  assert.equal(isUnhealthy({ calls: 1, failures: 0, streak: 0 }, { now, ...opts }), false)
})

test('ago degrades from seconds to days', () => {
  const now = 100 * 24 * HOUR
  assert.equal(ago(now - 30_000, now), '30 秒前')
  assert.equal(ago(now - 10 * MINUTE, now), '10 分钟前')
  assert.equal(ago(now - 5 * HOUR, now), '5 小时前')
  assert.equal(ago(now - 5 * 24 * HOUR, now), '5 天前')
})

test('renderReport says nothing when every tool works', () => {
  const now = 10 * HOUR
  const records = new Map([
    ['astock_quote', { calls: 9, failures: 0, streak: 0, lastOkAt: now - MINUTE }],
    ['old_outage', { calls: 3, failures: 3, streak: 3, lastFailAt: now - 48 * HOUR }],
  ])
  // An empty context contributes nothing: a standing "all healthy" banner would
  // spend tokens on every request to say nothing.
  assert.equal(renderReport(records, { now, ...opts }), '')
})

test('renderReport lists broken tools newest first, with the evidence and the limits', () => {
  const now = 10 * HOUR
  const records = new Map([
    ['astock_market_quotes', {
      calls: 4, failures: 4, streak: 4, lastFailAt: now - MINUTE,
      lastError: 'fetch failed / UND_ERR_SOCKET',
    }],
    ['astock_financials', {
      calls: 6, failures: 2, streak: 2, lastFailAt: now - 2 * HOUR, lastOkAt: now - 5 * HOUR,
      lastError: '积分不足',
    }],
    ['healthy_tool', { calls: 3, failures: 0, streak: 0, lastOkAt: now }],
  ])
  const text = renderReport(records, { now, ...opts })

  const first = text.indexOf('astock_market_quotes')
  const second = text.indexOf('astock_financials')
  assert.ok(first > -1 && second > first, 'newest failure first')
  assert.ok(!text.includes('healthy_tool'), 'working tools are not listed')
  assert.match(text, /UND_ERR_SOCKET/, 'the error is the useful part')
  assert.match(text, /never succeeded here/, 'a tool that never worked is distinguished')
  assert.match(text, /last succeeded 5 小时前/)
  // The report must not read as a prohibition — the cause may have cleared.
  assert.match(text, /not a prohibition/)
  assert.match(text, /do not substitute or invent data/)
})

test('renderReport caps how many tools it names', () => {
  const now = 10 * HOUR
  const records = new Map(
    Array.from({ length: 20 }, (_, i) => [`tool_${i}`, {
      calls: 3, failures: 3, streak: 3, lastFailAt: now - i * MINUTE,
    }]),
  )
  const text = renderReport(records, { now, ...opts, maxListed: 3 })
  assert.equal(text.split('\n').filter(line => line.startsWith('- ')).length, 3)
})
