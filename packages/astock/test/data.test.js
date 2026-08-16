import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeCode, PERIOD_NAMES } from '../lib/data.js'

test('normalizeCode maps code prefixes to EastMoney market ids', () => {
  assert.equal(normalizeCode('600519'), '1.600519') // Shanghai
  assert.equal(normalizeCode('000001'), '0.000001') // Shenzhen
  assert.equal(normalizeCode('300750'), '0.300750') // ChiNext
  assert.equal(normalizeCode('830799'), '2.830799') // Beijing
})

test('normalizeCode strips sh/sz/bj prefixes case-insensitively', () => {
  assert.equal(normalizeCode('sz000001'), '0.000001')
  assert.equal(normalizeCode('SH600000'), '1.600000')
  assert.equal(normalizeCode('bj430047'), '2.430047')
})

test('PERIOD_NAMES covers the periods the tools document', () => {
  for (const period of ['daily', 'weekly', 'monthly', 'yearly', '5min', '15min', '30min', '60min']) {
    assert.equal(typeof PERIOD_NAMES[period], 'string')
  }
})
