import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  sma, ema, rsi, kdj, boll, obv, williamsR, atr, dmi, calculateAllIndicators,
} from '../lib/indicators.js'
import { macd } from '../lib/indicators.js'

test('sma pads warm-up with null and averages the window', () => {
  assert.deepEqual(sma([1, 2, 3, 4, 5], 3), [null, null, 2, 3, 4])
})

test('ema seeds with SMA then smooths', () => {
  assert.deepEqual(ema([1, 2, 3, 4], 2), [null, 1.5, 2.5, 3.5])
})

test('macd returns aligned macd/signal/histogram arrays', () => {
  const close = Array.from({ length: 40 }, (_, i) => 10 + i * 0.5)
  const { macd: line, signal, histogram } = macd(close)
  assert.equal(line.length, close.length)
  assert.equal(signal.length, close.length)
  assert.equal(histogram.length, close.length)
  const last = close.length - 1
  assert.equal(typeof line[last], 'number')
  assert.ok(Math.abs(line[last] - signal[last] - histogram[last]) < 1e-9)
})

test('rsi is 100 on all-gain windows and 0 on all-loss windows', () => {
  assert.deepEqual(rsi([1, 2, 3, 4, 5, 6], 5), [null, null, null, null, null, 100])
  assert.deepEqual(rsi([6, 5, 4, 3, 2, 1], 5), [null, null, null, null, null, 0])
})

test('kdj initializes K and D at 50', () => {
  const { k, d, j } = kdj([2, 3, 4], [1, 2, 3], [2, 3, 4], 3)
  assert.deepEqual(k, [null, null, 50])
  assert.deepEqual(d, [null, null, 50])
  assert.deepEqual(j, [null, null, 50])
})

test('boll collapses to the middle band on constant prices', () => {
  const { middle, upper, lower } = boll([10, 10, 10], 3)
  assert.deepEqual(middle, [null, null, 10])
  assert.deepEqual(upper, [null, null, 10])
  assert.deepEqual(lower, [null, null, 10])
})

test('obv adds on up days, subtracts on down days, holds on flat days', () => {
  assert.deepEqual(obv([10, 11, 10, 10], [100, 200, 300, 400]), [100, 300, 0, 0])
})

test('williamsR is 0 at range high and -100 at range low', () => {
  assert.deepEqual(williamsR([2, 3], [1, 2], [2, 3], 2), [null, -0])
  assert.deepEqual(williamsR([2, 3], [1, 2], [2, 2], 2), [null, -50])
})

test('atr smooths true range', () => {
  assert.deepEqual(atr([3, 4, 5], [1, 2, 3], [2, 3, 4], 2), [null, 2, 2])
})

test('dmi yields numbers after the warm-up period', () => {
  const high = [3, 4, 5, 6, 7]
  const low = [1, 2, 3, 4, 5]
  const close = [2, 3, 4, 5, 6]
  const { pdi, mdi, adx } = dmi(high, low, close, 3)
  assert.deepEqual(pdi.slice(0, 3), [null, null, null])
  for (const series of [pdi, mdi, adx]) {
    assert.equal(series.length, high.length)
    assert.equal(typeof series[4], 'number')
  }
})

test('calculateAllIndicators honors the enable flags', () => {
  const klines = Array.from({ length: 70 }, (_, i) => ({
    open: 10 + i, high: 11 + i, low: 9 + i, close: 10.5 + i, volume: 1000 + i,
  }))
  const all = calculateAllIndicators(klines)
  for (const key of ['MA5', 'MA10', 'MA20', 'MA30', 'MA60', 'MACD', 'RSI', 'KDJ', 'BOLL', 'OBV', 'WilliamsR', 'ATR', 'DMI']) {
    assert.ok(key in all, `expected ${key}`)
  }
  const only = calculateAllIndicators(klines, {
    ma: false, macd: false, kdj: false, boll: false, obv: false,
    williamsR: false, atr: false, dmi: false, rsiPeriod: 6,
  })
  assert.deepEqual(Object.keys(only), ['RSI'])
  assert.equal(typeof only.RSI[69], 'number')
})
