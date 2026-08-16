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
 * Hosts serving the whole-market list, in preference order.
 *
 * The realtime shards answer the single-stock endpoints while REFUSING this
 * one — observed as a closed socket, not an HTTP status (2026-08). The delayed
 * shard serves the identical payload, so a fallback keeps whole-market
 * screening working through an upstream that is only partly available.
 */
const MARKET_HOSTS = ['push2.eastmoney.com', 'push2delay.eastmoney.com']

/** Quotes from this host lag the tape; screens should say so. */
const DELAYED_HOST = /(^|\.)push2delay\./

/**
 * Fetch the whole-market snapshot, page by page.
 * @param {Object} [options]
 * @param {number} [options.pageSize=100] - Rows per request.
 * @param {number} [options.maxPages=200] - Safety bound on paging.
 * @param {number} [options.pauseMs=120] - Delay between pages; the public API
 *   throttles bursty clients, and a whole sweep is ~60 requests.
 * @param {string[]} [options.hosts=MARKET_HOSTS] - Hosts to try, in order.
 * @param {AbortSignal} [options.signal] - Cancellation signal.
 * @param {Function} [options.fetchImpl=fetch] - Injected for tests.
 * @returns {Promise<{rows: Array<Object>, host: string, delayed: boolean}>}
 *   One row per listed stock, plus which host served them.
 */
async function fetchMarketQuotes({
  pageSize = 100, maxPages = 200, pauseMs = 120, hosts = MARKET_HOSTS, signal, fetchImpl = fetch,
} = {}) {
  const rows = []
  let total = 0
  let host
  for (let page = 1; page <= maxPages; page++) {
    signal?.throwIfAborted()
    const params = new URLSearchParams({
      pn: String(page), pz: String(pageSize), po: '1', np: '1',
      fltt: '2', invt: '2', fid: 'f3', fs: MARKET_SELECTOR, fields: LIST_FIELDS,
    })
    // The host is chosen once, on the first page: a sweep must not mix a
    // realtime page with a delayed one.
    const json = host === undefined
      ? await (async () => {
        const chosen = await fetchFirstServing(hosts, params, { signal, fetchImpl })
        host = chosen.host
        return chosen.json
      })()
      : await fetchPage(host, params, { signal, fetchImpl })
    const diff = json?.data?.diff ?? []
    total = Number(json?.data?.total) || total
    if (diff.length === 0) break
    for (const row of diff) rows.push(mapQuoteRow(row))
    if (total && rows.length >= total) break
    if (pauseMs > 0) await new Promise(resolve => setTimeout(resolve, pauseMs))
  }
  return { rows, host, delayed: DELAYED_HOST.test(host ?? '') }
}

/**
 * One list page from one host.
 * @param {string} host - EastMoney host
 * @param {URLSearchParams} params - Query parameters
 * @param {Object} options - signal/fetchImpl
 * @returns {Promise<Object>} Parsed JSON payload
 */
async function fetchPage(host, params, { signal, fetchImpl }) {
  const response = await fetchImpl(`https://${host}/api/qt/clist/get?${params.toString()}`, { signal })
  if (!response.ok) throw new Error(`HTTP ${response.status}: market snapshot from ${host}`)
  return response.json()
}

/**
 * First host that answers with rows. A host that closes the socket, errors, or
 * returns an empty market is treated as not serving; the last failure is
 * reported when every host is out.
 * @param {string[]} hosts - Candidate hosts, in preference order
 * @param {URLSearchParams} params - Query parameters
 * @param {Object} options - signal/fetchImpl
 * @returns {Promise<{host: string, json: Object}>} The serving host and its payload
 */
async function fetchFirstServing(hosts, params, { signal, fetchImpl }) {
  let lastError
  for (const host of hosts) {
    signal?.throwIfAborted()
    try {
      const json = await fetchPage(host, params, { signal, fetchImpl })
      if ((json?.data?.diff ?? []).length > 0) return { host, json }
      lastError = new Error(`empty market snapshot from ${host}`)
    } catch (error) {
      if (signal?.aborted) throw error
      lastError = error
    }
  }
  throw new Error(
    `全市场快照不可用(已尝试 ${hosts.join('、')}):${lastError?.message ?? 'no host answered'}`,
    { cause: lastError },
  )
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

export { fetchMarketQuotes, mapQuoteRow, isSt, daysListed, MARKET_HOSTS }
