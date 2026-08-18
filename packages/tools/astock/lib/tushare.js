/**
 * Tushare Pro data provider (https://tushare.pro).
 *
 * Single JSON-over-HTTP endpoint: POST { api_name, token, params, fields }
 * → { code, msg, data: { fields, items } }. The token and endpoint come from
 * plugin config — never hardcoded. Used for data EastMoney's public API does
 * not carry (daily fundamentals: PE-TTM, PB, dividend yield, …).
 *
 * @module dsh-plugin-astock/tushare
 */

import { finiteNumber } from './value.js';

/**
 * Convert a loose A-share code to Tushare's ts_code format.
 * '600519' → '600519.SH', 'sz000001' → '000001.SZ', '830799' → '830799.BJ'
 * @param {string} code - Stock code in any accepted format
 * @returns {string} Tushare ts_code
 */
function toTsCode(code, kind = 'stock') {
  let clean = String(code).replace(/^(sh|sz|bj)/i, '').replace(/\.(SH|SZ|BJ)$/i, '');
  while (clean.length < 6) clean = '0' + clean;
  // Convertible bonds are told apart by their first TWO digits, not the
  // first: 110/111/113/118 list in Shanghai, 123/127/128 in Shenzhen. Keying
  // on one digit sends every Shenzhen bond to the wrong exchange.
  if (kind === 'bond') {
    return `${clean}.${clean.startsWith('12') ? 'SZ' : 'SH'}`;
  }
  const table = { '6': 'SH', '5': 'SH', '9': 'SH', '0': 'SZ', '3': 'SZ', '2': 'SZ', '4': 'BJ', '8': 'BJ' };
  return `${clean}.${table[clean[0]] ?? 'SH'}`;
}

/**
 * Convert a Tushare columnar result ({ fields, items }) to row objects.
 * @param {{fields: string[], items: Array<Array<*>>}} data - Tushare data payload
 * @returns {Array<Object>} One object per row, keyed by field name
 */
function rowsToObjects(data) {
  if (!data || !Array.isArray(data.fields) || !Array.isArray(data.items)) return [];
  return data.items.map(item => {
    const row = {};
    data.fields.forEach((field, i) => { row[field] = item[i]; });
    return row;
  });
}

/** Tushare's own words for "you called this interface too often". */

/**
 * Plain 6-digit code from a Tushare ts_code ('000001.SZ' → '000001').
 * @param {string} tsCode - Tushare ts_code
 * @returns {string} Six-digit stock code
 */
function fromTsCode(tsCode) {
  return String(tsCode ?? '').split('.')[0];
}

/** Tushare `daily` columns → canonical bar fields. */
const DAILY_FIELDS = {
  open: 'open', high: 'high', low: 'low', close: 'close',
  pre_close: 'preClose', pct_chg: 'pctChg', vol: 'volume', amount: 'amount',
};

/**
 * Whole-market daily bars for one trading day — one request covers every
 * listed stock, which is what makes market-wide scans affordable.
 * @param {Object} options - endpoint/token/signal plus:
 * @param {string} options.tradeDate - Trading day, YYYYMMDD
 * @returns {Promise<Array<Object>>} Canonical bars, one per stock
 */
async function fetchDailyByDate({ query, tradeDate, signal }) {
  const rows = await query({
    apiName: 'daily', signal,
    params: { trade_date: tradeDate },
    fields: ['ts_code', 'trade_date', ...Object.keys(DAILY_FIELDS)].join(','),
  });
  return rows.map(row => mapDailyRow(row)).filter(bar => bar !== null);
}

/**
 * Map one `daily` row to a canonical bar. Rows without a usable code or close
 * are dropped; individual null metrics are omitted (lossless JSON only).
 * @param {Object} row - Raw daily row
 * @returns {Object|null} Canonical bar, or null when unusable
 */
function mapDailyRow(row) {
  const code = fromTsCode(row.ts_code);
  if (!/^\d{6}$/.test(code)) return null;
  const bar = { code, date: String(row.trade_date ?? '') };
  for (const [field, key] of Object.entries(DAILY_FIELDS)) {
    const value = finiteNumber(row[field]);
    if (value !== undefined) bar[key] = value;
  }
  return bar.close === undefined ? null : bar;
}

/**
 * Run `worker` over `items` with bounded concurrency, preserving order.
 * Bulk fetching is many independent requests; unbounded parallelism trips
 * provider rate limits, and full serialization is needlessly slow.
 * @param {Array} items - Work items
 * @param {Function} worker - async (item) => result
 * @param {number} limit - Maximum in-flight workers
 * @returns {Promise<Array>} Results in input order
 */
async function mapWithConcurrency(items, worker, limit) {
  const results = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

export {
  toTsCode,
  fromTsCode,
  fetchDailyByDate,
  mapDailyRow,
  mapWithConcurrency,
};
