/**
 * Whole-market snapshot from EastMoney's list API.
 *
 * Screening questions ("which stocks satisfy …") are answered by scanning the
 * market once, not by querying thousands of stocks one at a time — the
 * per-stock path gets rate-limited long before it finishes. One paged sweep
 * carries realtime price, market caps, listing date and name (the ST marker),
 * which together cover the cheap half of most screens.
 *
 * @module dsh-plugin-astock/market
 */

import { assignFinite } from './value.js'

/** Board selector: Shenzhen A + ChiNext, Shanghai A + STAR, Beijing. */
const MARKET_SELECTOR = 'm:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23,m:0+t:81+s:2048'

/** EastMoney list fields → canonical names. */
const LIST_FIELDS = 'f12,f14,f2,f3,f20,f21,f26'

/**
 * Fetch the whole-market realtime snapshot, page by page.
 * @param {Object} [options]
 * @param {number} [options.pageSize=100] - Rows per request.
 * @param {number} [options.maxPages=200] - Safety bound on paging.
 * @param {number} [options.pauseMs=120] - Delay between pages; the public API
 *   throttles bursty clients, and a whole sweep is ~60 requests.
 * @param {AbortSignal} [options.signal] - Cancellation signal.
 * @param {Function} [options.fetchImpl=fetch] - Injected for tests.
 * @returns {Promise<Array<Object>>} One row per listed stock.
 */
async function fetchMarketQuotes({
  pageSize = 100, maxPages = 200, pauseMs = 120, signal, fetchImpl = fetch,
} = {}) {
  const rows = []
  let total = 0
  for (let page = 1; page <= maxPages; page++) {
    signal?.throwIfAborted()
    const params = new URLSearchParams({
      pn: String(page), pz: String(pageSize), po: '1', np: '1',
      fltt: '2', invt: '2', fid: 'f3', fs: MARKET_SELECTOR, fields: LIST_FIELDS,
    })
    const url = `https://push2.eastmoney.com/api/qt/clist/get?${params.toString()}`
    const response = await fetchImpl(url, { signal })
    if (!response.ok) throw new Error(`HTTP ${response.status}: market snapshot page ${page}`)
    const json = await response.json()
    const diff = json?.data?.diff ?? []
    total = Number(json?.data?.total) || total
    if (diff.length === 0) break
    for (const row of diff) rows.push(mapQuoteRow(row))
    if (total && rows.length >= total) break
    if (pauseMs > 0) await new Promise(resolve => setTimeout(resolve, pauseMs))
  }
  return rows
}

/**
 * Map one EastMoney list row to the canonical shape. Fields the API reports
 * as '-' (suspended, or not applicable) become undefined rather than NaN so
 * the value stays lossless JSON.
 * @param {Object} row - Raw list row
 * @returns {Object} Canonical market row
 */
function mapQuoteRow(row) {
  const code = String(row.f12 ?? '')
  const name = String(row.f14 ?? '')
  const mapped = assignFinite({ code, name, isSt: isSt(name) }, {
    price: row.f2,
    changePct: row.f3,
    totalMarketCap: row.f20,
    circulatingMarketCap: row.f21,
  })
  const listDate = String(row.f26 ?? '')
  if (/^\d{8}$/.test(listDate)) mapped.listDate = listDate
  return mapped
}

/**
 * ST / delisting marker. EastMoney carries it in the display name, which is
 * the only place the list API exposes the status.
 * @param {string} name - Stock display name
 * @returns {boolean} True for ST, *ST, S*ST and delisting names
 */
function isSt(name) {
  return /ST/i.test(name) || name.includes('退')
}

/**
 * Calendar days between a YYYYMMDD listing date and a reference day.
 * @param {string} listDate - Listing date, YYYYMMDD
 * @param {number} [nowMs=Date.now()] - Reference instant; injected in tests
 * @returns {number} Days listed, or 0 when the date is unusable
 */
function daysListed(listDate, nowMs = Date.now()) {
  if (!/^\d{8}$/.test(listDate ?? '')) return 0
  const year = Number(listDate.slice(0, 4))
  const month = Number(listDate.slice(4, 6))
  const day = Number(listDate.slice(6, 8))
  return Math.max(0, Math.floor((nowMs - Date.UTC(year, month - 1, day)) / 86_400_000))
}

export { fetchMarketQuotes, mapQuoteRow, isSt, daysListed }
