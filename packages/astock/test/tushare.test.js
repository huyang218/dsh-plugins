import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  toTsCode, fromTsCode, rowsToObjects, tushareQuery,
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
