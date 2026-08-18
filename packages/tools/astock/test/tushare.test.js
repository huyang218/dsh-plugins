import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  toTsCode, fromTsCode, rowsToObjects, tushareQuery, createRateLimiter,
  fetchTradeDates, fetchDailyByDate, mapDailyRow, mapWithConcurrency,
} from '../lib/tushare.js'

/** Stub fetch that answers Tushare calls from a per-api handler map. */
function stubTushare(t, handlers) {
  const calls = []
  const real = globalThis.fetch
  t.after(() => { globalThis.fetch = real })
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body)
    calls.push(body)
    const data = handlers[body.api_name](body.params)
    return new Response(JSON.stringify({ code: 0, msg: null, data }))
  }
  return calls
}

test('toTsCode maps prefixes to exchange suffixes', () => {
  assert.equal(toTsCode('600519'), '600519.SH')
  assert.equal(toTsCode('000001'), '000001.SZ')
  assert.equal(toTsCode('300750'), '300750.SZ')
  assert.equal(toTsCode('830799'), '830799.BJ')
  assert.equal(toTsCode('sz000001'), '000001.SZ')
  assert.equal(toTsCode('600519.SH'), '600519.SH') // already ts_code: unchanged
})

test('fromTsCode recovers the plain six-digit code', () => {
  assert.equal(fromTsCode('000001.SZ'), '000001')
  assert.equal(fromTsCode('600519.SH'), '600519')
  assert.equal(fromTsCode(undefined), '')
})

test('mapDailyRow keeps lossless bars and drops unusable rows', () => {
  const bar = mapDailyRow({
    ts_code: '000001.SZ', trade_date: '20260803', open: 11.5, high: 11.7,
    low: 11.44, close: 11.62, pre_close: 11.5, pct_chg: 1.04, vol: 1000, amount: 2000,
  })
  assert.deepEqual(bar, {
    code: '000001', date: '20260803', open: 11.5, high: 11.7, low: 11.44,
    close: 11.62, preClose: 11.5, pctChg: 1.04, volume: 1000, amount: 2000,
  })
  // Tushare sends null metrics for halted names; a bar without a close is useless.
  assert.equal(mapDailyRow({ ts_code: '000002.SZ', trade_date: '20260803', close: null }), null)
  assert.equal(mapDailyRow({ ts_code: 'BAD', trade_date: '20260803', close: 1 }), null)
})

test('fetchTradeDates returns the trailing window, oldest first', async (t) => {
  const calendar = ['20260728', '20260729', '20260730', '20260731', '20260803']
  const calls = stubTushare(t, {
    // Tushare returns the calendar unsorted in practice; the helper sorts.
    trade_cal: () => ({ fields: ['cal_date'], items: [...calendar].reverse().map(d => [d]) }),
  })
  const dates = await fetchTradeDates({
    endpoint: 'https://x.test', token: 'tok', endDate: '20260803', count: 3,
  })
  assert.deepEqual(dates, ['20260730', '20260731', '20260803'])
  assert.equal(calls[0].params.is_open, '1')
  assert.equal(calls[0].params.end_date, '20260803')
  assert.ok(calls[0].params.start_date < '20260803', 'range must reach back before the end date')
})

test('fetchDailyByDate maps a whole trading day of bars', async (t) => {
  stubTushare(t, {
    daily: params => ({
      fields: ['ts_code', 'trade_date', 'open', 'high', 'low', 'close', 'pre_close', 'pct_chg', 'vol', 'amount'],
      items: [
        ['000001.SZ', params.trade_date, 11.5, 11.7, 11.44, 11.62, 11.5, 1.04, 1000, 2000],
        ['600519.SH', params.trade_date, 1350, 1363, 1346, 1359, 1350, 0.66, 20, 30],
        ['000003.SZ', params.trade_date, null, null, null, null, null, null, null, null],
      ],
    }),
  })
  const bars = await fetchDailyByDate({ endpoint: 'https://x.test', token: 'tok', tradeDate: '20260803' })
  assert.equal(bars.length, 2, 'the all-null row is dropped')
  assert.deepEqual(bars.map(b => b.code), ['000001', '600519'])
  assert.equal(bars[1].low, 1346)
})

test('mapWithConcurrency preserves order and bounds parallelism', async () => {
  let inFlight = 0
  let peak = 0
  const results = await mapWithConcurrency([1, 2, 3, 4, 5, 6, 7], async value => {
    peak = Math.max(peak, ++inFlight)
    await new Promise(resolve => setTimeout(resolve, 5))
    inFlight--
    return value * 2
  }, 3)
  assert.deepEqual(results, [2, 4, 6, 8, 10, 12, 14])
  assert.ok(peak <= 3, `peak concurrency ${peak} exceeded the limit`)
})

test('rowsToObjects zips fields with items and tolerates malformed payloads', () => {
  assert.deepEqual(
    rowsToObjects({ fields: ['a', 'b'], items: [[1, 2], [3, null]] }),
    [{ a: 1, b: 2 }, { a: 3, b: null }],
  )
  assert.deepEqual(rowsToObjects(null), [])
  assert.deepEqual(rowsToObjects({}), [])
})

test('tushareQuery posts the request shape and surfaces API errors', async (t) => {
  const calls = []
  const realFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = realFetch })

  globalThis.fetch = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) })
    return new Response(JSON.stringify({
      code: 0, msg: null,
      data: { fields: ['ts_code', 'pe'], items: [['600519.SH', 18.8]] },
    }))
  }
  const rows = await tushareQuery({
    endpoint: 'https://example.test', token: 'tok', apiName: 'daily_basic',
    params: { ts_code: '600519.SH' }, fields: 'ts_code,pe',
  })
  assert.deepEqual(rows, [{ ts_code: '600519.SH', pe: 18.8 }])
  assert.equal(calls[0].url, 'https://example.test')
  assert.deepEqual(calls[0].body, {
    api_name: 'daily_basic', token: 'tok',
    params: { ts_code: '600519.SH' }, fields: 'ts_code,pe',
  })

  // Tushare-level failure (e.g. 积分不足) must throw, not return rows.
  globalThis.fetch = async () => new Response(JSON.stringify({ code: 40203, msg: '积分不足' }))
  await assert.rejects(
    () => tushareQuery({ endpoint: 'https://example.test', token: 'tok', apiName: 'daily_basic' }),
    /积分不足/,
  )
})

test('createRateLimiter meters per interface and waits out the window', async () => {
  let clock = 1_000_000
  const waited = []
  // The limiter only sleeps; the clock moves because the caller's own work
  // does. Advancing it here is what makes the window slide.
  const acquire = createRateLimiter({
    perMinute: 2,
    windowMs: 60000,
    now: () => clock,
    wait: async (ms) => { waited.push(ms); clock += ms },
  })

  await acquire('daily')
  await acquire('daily')
  assert.deepEqual(waited, [], 'the first two fit in the window')

  // The third has to wait for the oldest of the two to age out.
  await acquire('daily')
  assert.deepEqual(waited, [60000])

  // A different interface has its own quota — Tushare meters them separately.
  await acquire('trade_cal')
  assert.deepEqual(waited, [60000], 'trade_cal must not pay for daily')

  // perMinute 0 disables the gate entirely.
  const open = createRateLimiter({ perMinute: 0, wait: async () => assert.fail('must not wait') })
  for (let i = 0; i < 10; i++) await open('daily')
})

test('tushareQuery retries the provider quota message, then surfaces it', async (t) => {
  const real = globalThis.fetch
  t.after(() => { globalThis.fetch = real })

  const quota = '抱歉，您访问接口(daily)频率超限(500次/分钟)'
  let attempts = 0
  globalThis.fetch = async () => {
    attempts += 1
    return new Response(JSON.stringify(attempts < 3
      ? { code: 40203, msg: quota }
      : { code: 0, msg: null, data: { fields: ['ts_code'], items: [['000001.SZ']] } }))
  }
  const waited = []
  const rows = await tushareQuery({
    endpoint: 'https://example.test', token: 'tok', apiName: 'daily',
    wait: async (ms) => { waited.push(ms) },
  })
  assert.deepEqual(rows, [{ ts_code: '000001.SZ' }])
  assert.equal(attempts, 3, 'two retries before the answer')
  assert.deepEqual(waited, [3000, 6000], 'backoff grows between retries')

  // Retries are bounded: a quota that never clears still fails the call.
  attempts = 0
  globalThis.fetch = async () => {
    attempts += 1
    return new Response(JSON.stringify({ code: 40203, msg: quota }))
  }
  await assert.rejects(
    () => tushareQuery({
      endpoint: 'https://example.test', token: 'tok', apiName: 'daily',
      rateRetries: 1, wait: async () => {},
    }),
    /频率超限/,
  )
  assert.equal(attempts, 2, 'one retry, then surface')
})
