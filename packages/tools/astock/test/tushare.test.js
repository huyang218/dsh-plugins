import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  toTsCode, fromTsCode, fetchDailyByDate, mapDailyRow, mapWithConcurrency,
} from '../lib/tushare.js'

// The HTTP client, quota gate and trading calendar live in dsh-plugin-tushare
// and are tested there; what remains here is astock's own code shaping.

test('toTsCode maps share prefixes to exchange suffixes', () => {
  assert.equal(toTsCode('600519'), '600519.SH')
  assert.equal(toTsCode('000001'), '000001.SZ')
  assert.equal(toTsCode('300750'), '300750.SZ')
  assert.equal(toTsCode('830799'), '830799.BJ')
  assert.equal(toTsCode('sz000001'), '000001.SZ')
  assert.equal(toTsCode('600519.SH'), '600519.SH')
})

test('toTsCode routes convertible bonds by their two-digit prefix', () => {
  // Bonds reuse leading digits that mean something else for shares: keying on
  // the first digit alone sends every Shenzhen bond to Shanghai.
  assert.equal(toTsCode('113050', 'bond'), '113050.SH')
  assert.equal(toTsCode('110092', 'bond'), '110092.SH')
  assert.equal(toTsCode('123456', 'bond'), '123456.SZ')
  assert.equal(toTsCode('127012', 'bond'), '127012.SZ')
  assert.equal(toTsCode('128095', 'bond'), '128095.SZ')
})

test('fromTsCode recovers the plain six-digit code', () => {
  assert.equal(fromTsCode('000001.SZ'), '000001')
  assert.equal(fromTsCode('600519.SH'), '600519')
  assert.equal(fromTsCode(undefined), '')
})

test('mapDailyRow keeps lossless bars and drops unusable rows', () => {
  assert.deepEqual(mapDailyRow({
    ts_code: '000001.SZ', trade_date: '20260803', open: 11.5, high: 11.7,
    low: 11.44, close: 11.62, pre_close: 11.5, pct_chg: 1.04, vol: 1000, amount: 2000,
  }), {
    code: '000001', date: '20260803', open: 11.5, high: 11.7, low: 11.44,
    close: 11.62, preClose: 11.5, pctChg: 1.04, volume: 1000, amount: 2000,
  })
  // Tushare sends nulls for halted names; a bar without a close is useless.
  assert.equal(mapDailyRow({ ts_code: '000002.SZ', trade_date: '20260803', close: null }), null)
  assert.equal(mapDailyRow({ ts_code: 'BAD', trade_date: '20260803', close: 1 }), null)
})

test('fetchDailyByDate asks the injected query for one whole trading day', async () => {
  const seen = []
  const query = async ({ apiName, params, fields }) => {
    seen.push({ apiName, params, fields })
    return [
      { ts_code: '000001.SZ', trade_date: params.trade_date, close: 11.62, low: 11.44 },
      { ts_code: '600519.SH', trade_date: params.trade_date, close: 1359, low: 1346 },
      { ts_code: '000003.SZ', trade_date: params.trade_date, close: null },
    ]
  }
  const bars = await fetchDailyByDate({ query, tradeDate: '20260803' })
  assert.equal(seen[0].apiName, 'daily')
  assert.equal(seen[0].params.trade_date, '20260803')
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
