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
function toTsCode(code) {
  let clean = code.replace(/^(sh|sz|bj)/i, '').replace(/\.(SH|SZ|BJ)$/i, '');
  while (clean.length < 6) clean = '0' + clean;
  const suffix = { '6': 'SH', '5': 'SH', '9': 'SH', '0': 'SZ', '3': 'SZ', '2': 'SZ', '4': 'BJ', '8': 'BJ' }[clean[0]] || 'SH';
  return `${clean}.${suffix}`;
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

/**
 * Call a Tushare Pro API.
 * @param {Object} options
 * @param {string} options.endpoint - API endpoint URL (from config)
 * @param {string} options.token - Tushare Pro token (from config)
 * @param {string} options.apiName - API name, e.g. 'daily_basic'
 * @param {Object} [options.params] - API parameters
 * @param {string} [options.fields] - Comma-separated fields to return
 * @param {AbortSignal} [options.signal] - Cancellation signal
 * @returns {Promise<Array<Object>>} Result rows as objects
 */
async function tushareQuery({ endpoint, token, apiName, params = {}, fields = '', signal }) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_name: apiName, token, params, fields }),
    signal,
  });
  if (!response.ok) {
    throw new Error(`Tushare HTTP ${response.status} for ${apiName}`);
  }
  const json = await response.json();
  if (json.code !== 0) {
    throw new Error(`Tushare ${apiName} failed: ${json.msg || `code ${json.code}`}`);
  }
  return rowsToObjects(json.data);
}

/**
 * Plain 6-digit code from a Tushare ts_code ('000001.SZ' → '000001').
 * @param {string} tsCode - Tushare ts_code
 * @returns {string} Six-digit stock code
 */
function fromTsCode(tsCode) {
  return String(tsCode ?? '').split('.')[0];
}

/**
 * Trading days ending at (and including) `endDate`, oldest first.
 *
 * Screening windows are counted in trading days, so the calendar has to come
 * from the exchange rather than from calendar arithmetic.
 * @param {Object} options - endpoint/token/signal plus:
 * @param {string} options.endDate - Inclusive window end, YYYYMMDD
 * @param {number} options.count - How many trading days to return
 * @returns {Promise<string[]>} Trading days, ascending
 */
async function fetchTradeDates({ endpoint, token, endDate, count, signal }) {
  // Over-reach the calendar range so `count` trading days are always covered:
  // ~250 trading days a year, plus a floor for very short windows.
  const spanDays = Math.ceil(count * 1.7) + 30;
  const end = new Date(Date.UTC(
    Number(endDate.slice(0, 4)), Number(endDate.slice(4, 6)) - 1, Number(endDate.slice(6, 8)),
  ));
  const start = new Date(end.getTime() - spanDays * 86_400_000);
  const startDate = [
    start.getUTCFullYear(),
    String(start.getUTCMonth() + 1).padStart(2, '0'),
    String(start.getUTCDate()).padStart(2, '0'),
  ].join('');

  const rows = await tushareQuery({
    endpoint, token, apiName: 'trade_cal', signal,
    params: { exchange: 'SSE', start_date: startDate, end_date: endDate, is_open: '1' },
    fields: 'cal_date',
  });
  const dates = rows.map(row => String(row.cal_date)).sort();
  return dates.slice(-count);
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
async function fetchDailyByDate({ endpoint, token, tradeDate, signal }) {
  const rows = await tushareQuery({
    endpoint, token, apiName: 'daily', signal,
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
  rowsToObjects,
  tushareQuery,
  fetchTradeDates,
  fetchDailyByDate,
  mapDailyRow,
  mapWithConcurrency,
};
