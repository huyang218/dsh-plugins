import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mapQuote, normalizeCode, PERIOD_NAMES } from '../lib/data.js'

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

const FULL_QUOTE_PAYLOAD = {
  f58: '贵州茅台', f46: 134000, f44: 135500, f45: 133000, f43: 134199,
  f60: 133900, f47: 25000, f48: 3.5e9, f51: 147290, f52: 120510,
  f169: 299, f170: 22, f168: 15, f171: 187, f162: 2150,
  f116: 1.68e12, f117: 1.68e12,
}

test('mapQuote maps a full EastMoney payload with cent→yuan conversion', () => {
  const q = mapQuote('600519', FULL_QUOTE_PAYLOAD)
  assert.equal(q.name, '贵州茅台')
  assert.equal(q.market, 'SH')
  assert.equal(q.price, 1341.99)
  assert.equal(q.highLimit, 1472.9)
  assert.equal(q.lowLimit, 1205.1)
  assert.equal(q.pe, 21.5)
})

test('mapQuote omits fields EastMoney reports as "-" instead of emitting NaN', () => {
  // Loss-making / suspended stocks return "-" for pe and several prices.
  const q = mapQuote('600519', { ...FULL_QUOTE_PAYLOAD, f162: '-', f43: '-', f171: '-' })
  assert.ok(!('pe' in q), 'pe must be omitted, not NaN')
  assert.ok(!('price' in q))
  assert.ok(!('amplitude' in q))
  for (const value of Object.values(q)) {
    if (typeof value === 'number') {
      assert.ok(Number.isFinite(value) && !Object.is(value, -0), `non-lossless number: ${value}`)
    }
  }
})

test('PERIOD_NAMES covers the periods the tools document', () => {
  for (const period of ['daily', 'weekly', 'monthly', 'yearly', '5min', '15min', '30min', '60min']) {
    assert.equal(typeof PERIOD_NAMES[period], 'string')
  }
})

test('fetchKline enforces its own limit when the API ignores it', async (t) => {
  // Observed live: with an open-ended range EastMoney answers with the whole
  // history — 5,985 bars for a request of 30. The renderer only shows the
  // tail, so the excess rode invisibly into the canonical value and, in Code
  // Mode, across the worker boundary.
  const { fetchKline } = await import('../lib/data.js')
  const real = globalThis.fetch
  t.after(() => { globalThis.fetch = real })

  const history = Array.from({ length: 500 }, (_, i) =>
    `2026-01-${String((i % 28) + 1).padStart(2, '0')},10,${10 + i},11,9,100,1000,1,1,1,1`)
  globalThis.fetch = async () => new Response(JSON.stringify({
    data: { name: '测试', klines: history },
  }))

  const bounded = await fetchKline('600519', { period: 'daily', limit: 30 })
  assert.equal(bounded.klines.length, 30, 'the caller asked for 30')
  assert.equal(bounded.total, 30, 'total must describe what is returned')
  // The tail is what a chart and a renderer both want: the most recent bars.
  assert.equal(bounded.klines.at(-1).close, history.at(-1).split(',')[2] * 1)

  const capped = await fetchKline('600519', { period: 'daily', limit: 99999 })
  assert.equal(capped.klines.length, 500, 'a limit above the data returns what exists')
})
