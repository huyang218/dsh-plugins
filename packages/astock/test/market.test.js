import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fetchMarketQuotes, mapQuoteRow, isSt, daysListed, MARKET_HOSTS } from '../lib/market.js'

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
  const { rows, host, delayed } = await fetchMarketQuotes({ pageSize: 2, pauseMs: 0, fetchImpl })
  assert.equal(rows.length, 4)
  assert.deepEqual(pages, [1, 2], 'stops as soon as total rows are collected')
  assert.equal(rows[0].code, '000010')
  assert.equal(host, MARKET_HOSTS[0], 'the preferred host serves when it answers')
  assert.equal(delayed, false)
})

test('fetchMarketQuotes falls back to the next host and reports the delay', async () => {
  const tried = []
  const makeRow = i => ({ f12: String(i).padStart(6, '0'), f14: `股票${i}`, f2: 10, f3: 0, f20: 1e9, f21: 1e9, f26: 20200101 })
  const fetchImpl = async (url) => {
    const host = new URL(url).host
    tried.push(host)
    // What the realtime shards actually do: close the socket, no HTTP status.
    if (host === 'push2.eastmoney.com') throw new TypeError('fetch failed')
    const page = Number(new URL(url).searchParams.get('pn'))
    return { ok: true, json: async () => ({ data: { total: 1, diff: page === 1 ? [makeRow(1)] : [] } }) }
  }
  const { rows, host, delayed } = await fetchMarketQuotes({ pageSize: 2, pauseMs: 0, fetchImpl })
  assert.equal(rows.length, 1)
  assert.equal(host, 'push2delay.eastmoney.com')
  assert.equal(delayed, true, 'a screen must be able to say the prices lag')
  assert.deepEqual(tried, ['push2.eastmoney.com', 'push2delay.eastmoney.com'])
})

test('fetchMarketQuotes stops on a later empty page and fails when no host serves', async () => {
  // An empty FIRST page means the host is not serving the market: silently
  // screening zero stocks would answer "no matches" instead of failing.
  const empty = async () => ({ ok: true, json: async () => ({ data: { total: 999, diff: [] } }) })
  await assert.rejects(
    () => fetchMarketQuotes({ pauseMs: 0, fetchImpl: empty }),
    /全市场快照不可用/,
  )

  const failing = async () => ({ ok: false, status: 503, json: async () => ({}) })
  await assert.rejects(() => fetchMarketQuotes({ pauseMs: 0, fetchImpl: failing }), /503/)

  // A later empty page is still the pagination terminator.
  const makeRow = i => ({ f12: String(i).padStart(6, '0'), f14: `股票${i}`, f2: 10, f3: 0, f20: 1e9, f21: 1e9, f26: 20200101 })
  const twoThenEmpty = async (url) => {
    const page = Number(new URL(url).searchParams.get('pn'))
    return { ok: true, json: async () => ({ data: { total: 999, diff: page === 1 ? [makeRow(1), makeRow(2)] : [] } }) }
  }
  const { rows } = await fetchMarketQuotes({ pageSize: 2, pauseMs: 0, fetchImpl: twoThenEmpty })
  assert.equal(rows.length, 2)
})

test('daysListed measures calendar age from the listing date', () => {
  const now = Date.UTC(2026, 7, 16)
  assert.equal(daysListed('20260815', now), 1)
  assert.equal(daysListed('20250816', now), 365)
  assert.equal(daysListed('', now), 0)
  assert.equal(daysListed(undefined, now), 0)
})
