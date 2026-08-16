import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fetchMarketQuotes, mapQuoteRow, isSt, daysListed } from '../lib/market.js'

test('isSt flags ST, *ST and delisting names', () => {
  assert.equal(isSt('*ST 天成'), true)
  assert.equal(isSt('ST生物'), true)
  assert.equal(isSt('退市海润'), true)
  assert.equal(isSt('贵州茅台'), false)
})

test('mapQuoteRow keeps lossless numbers and drops "-" placeholders', () => {
  const row = mapQuoteRow({
    f12: '600519', f14: '贵州茅台', f2: 1341.99, f3: 0.71,
    f20: 1.68e12, f21: 1.68e12, f26: 20010827,
  })
  assert.equal(row.code, '600519')
  assert.equal(row.isSt, false)
  assert.equal(row.price, 1341.99)
  assert.equal(row.listDate, '20010827')

  // Suspended stocks report '-' for price fields.
  const halted = mapQuoteRow({ f12: '000001', f14: '平安银行', f2: '-', f3: '-', f21: 1e10, f26: 19910403 })
  assert.ok(!('price' in halted), 'price must be omitted, not NaN')
  assert.ok(!('changePct' in halted))
  assert.equal(halted.circulatingMarketCap, 1e10)
})

test('fetchMarketQuotes pages until total is reached', async () => {
  const pages = []
  const makeRow = i => ({ f12: String(i).padStart(6, '0'), f14: `股票${i}`, f2: 10, f3: 0, f20: 1e9, f21: 1e9, f26: 20200101 })
  const fetchImpl = async (url) => {
    const page = Number(new URL(url).searchParams.get('pn'))
    pages.push(page)
    const diff = page <= 2 ? Array.from({ length: 2 }, (_, i) => makeRow(page * 10 + i)) : []
    return { ok: true, json: async () => ({ data: { total: 4, diff } }) }
  }
  const rows = await fetchMarketQuotes({ pageSize: 2, pauseMs: 0, fetchImpl })
  assert.equal(rows.length, 4)
  assert.deepEqual(pages, [1, 2], 'stops as soon as total rows are collected')
  assert.equal(rows[0].code, '000010')
})

test('fetchMarketQuotes stops on an empty page and surfaces HTTP errors', async () => {
  const empty = async () => ({ ok: true, json: async () => ({ data: { total: 999, diff: [] } }) })
  assert.deepEqual(await fetchMarketQuotes({ pauseMs: 0, fetchImpl: empty }), [])

  const failing = async () => ({ ok: false, status: 503, json: async () => ({}) })
  await assert.rejects(() => fetchMarketQuotes({ pauseMs: 0, fetchImpl: failing }), /503/)
})

test('daysListed measures calendar age from the listing date', () => {
  const now = Date.UTC(2026, 7, 16)
  assert.equal(daysListed('20260815', now), 1)
  assert.equal(daysListed('20250816', now), 365)
  assert.equal(daysListed('', now), 0)
  assert.equal(daysListed(undefined, now), 0)
})
