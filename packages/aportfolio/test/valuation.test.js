import { test } from 'node:test'
import assert from 'node:assert/strict'
import { valuePosition, summarize, targetHit, money } from '../lib/valuation.js'

test('valuePosition computes market value and profit against the live price', () => {
  const row = valuePosition({ code: '600519', shares: 100, cost: 1200 }, { name: '贵州茅台', price: 1300, changePct: 1.2 })
  assert.equal(row.marketValue, 130_000)
  assert.equal(row.costValue, 120_000)
  assert.equal(row.profit, 10_000)
  assert.ok(Math.abs(row.profitPct - 8.3333) < 0.001)
  assert.equal(row.name, '贵州茅台')
})

test('a position without a price is unknown, not worthless', () => {
  // A quote that failed must not price the holding at zero: the number would
  // look authoritative and drag the whole portfolio total down with it.
  const row = valuePosition({ code: '600519', shares: 100, cost: 1200 }, undefined)
  assert.equal(row.shares, 100)
  assert.ok(!('marketValue' in row))
  assert.ok(!('profit' in row))
  assert.ok(!('profitPct' in row))
})

test('a position without a recorded cost still gets a market value', () => {
  const row = valuePosition({ code: '000001', shares: 500 }, { price: 11.5 })
  assert.equal(row.marketValue, 5750)
  assert.ok(!('profit' in row), 'no cost means no profit, not a profit of zero')
})

test('summarize totals only what it could price, and says how much it could not', () => {
  const rows = [
    valuePosition({ code: 'a', shares: 100, cost: 10 }, { price: 12 }),
    valuePosition({ code: 'b', shares: 200, cost: 5 }, { price: 4 }),
    valuePosition({ code: 'c', shares: 300, cost: 7 }, undefined),
  ]
  const summary = summarize(rows)
  assert.equal(summary.marketValue, 1200 + 800)
  assert.equal(summary.costValue, 1000 + 1000)
  assert.equal(summary.profit, 0)
  assert.equal(summary.unpriced, 1, 'the unpriced holding is reported, not folded in at zero')

  const weights = summary.rows.filter(r => r.weightPct !== undefined)
  assert.equal(weights.length, 2)
  assert.ok(Math.abs(weights.reduce((s, r) => s + r.weightPct, 0) - 100) < 1e-9)
  assert.ok(!('weightPct' in summary.rows[2]), 'an unpriced row has no weight')
})

test('summarize on an empty book reports nothing rather than dividing by zero', () => {
  const summary = summarize([])
  assert.equal(summary.marketValue, 0)
  assert.equal(summary.unpriced, 0)
  assert.ok(!('profitPct' in summary))
})

test('targetHit fires on either side and stays quiet without a price', () => {
  assert.equal(targetHit({ targetBuy: 10 }, { price: 9.5 }), 'buy')
  assert.equal(targetHit({ targetBuy: 10 }, { price: 10 }), 'buy', 'reaching the level counts')
  assert.equal(targetHit({ targetSell: 20 }, { price: 21 }), 'sell')
  assert.equal(targetHit({ targetBuy: 10, targetSell: 20 }, { price: 15 }), undefined)
  assert.equal(targetHit({ targetBuy: 10 }, undefined), undefined)
  assert.equal(targetHit({}, { price: 5 }), undefined)
})

test('money reads the way a Chinese statement does', () => {
  assert.equal(money(1234.5), '1234.50')
  assert.equal(money(123_456), '12.35万')
  assert.equal(money(1.5e8), '1.50亿')
  assert.equal(money(-123_456), '-12.35万')
})
