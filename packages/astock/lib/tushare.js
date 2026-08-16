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

export { toTsCode, rowsToObjects, tushareQuery };
