/**
 * Live prices for the codes a portfolio holds.
 *
 * Deliberately self-contained rather than reaching into the astock plugin: a
 * portfolio is worth having on its own, and a handful of single-stock requests
 * is a fraction of what a market sweep costs. The endpoint is the same public
 * EastMoney quote API, and the twenty lines that call it are cheaper than a
 * dependency between two independently installable packages.
 *
 * @module dsh-plugin-aportfolio/quotes
 */

/** Leading digit → EastMoney market id (0 Shenzhen, 1 Shanghai, 2 Beijing). */
const MARKET = { 6: '1', 5: '1', 9: '1', 0: '0', 3: '0', 2: '0', 4: '2', 8: '2' };

/**
 * Normalize a loose code to EastMoney's `<market>.<code>` secid.
 * @param {string} code - Stock code in any accepted form
 * @returns {string} secid
 */
function toSecid(code) {
  const clean = String(code).replace(/^(sh|sz|bj)/i, '').replace(/\.(SH|SZ|BJ)$/i, '').padStart(6, '0');
  return `${MARKET[clean[0]] ?? '1'}.${clean}`;
}

/** Six-digit code from any accepted form. */
function normalizeCode(code) {
  return String(code).replace(/^(sh|sz|bj)/i, '').replace(/\.(SH|SZ|BJ)$/i, '').padStart(6, '0');
}

/**
 * Fetch the current price and name for one stock.
 *
 * Prices arrive scaled by 100. A field the API cannot supply comes back as
 * `'-'`, and `Number('-')` is NaN, so an unusable price is left undefined
 * rather than turned into a number that would silently price a position at
 * zero.
 * @param {string} code - Stock code
 * @param {Object} [options] - `{ signal, fetchImpl }`
 * @returns {Promise<{code: string, name?: string, price?: number, preClose?: number}>}
 */
async function fetchQuote(code, { signal, fetchImpl = fetch } = {}) {
  const params = new URLSearchParams({
    secid: toSecid(code),
    ut: '7eea3edcaed734bea9c758c1c0a6f0b3',
    fields: 'f43,f58,f60,f170',
  });
  const response = await fetchImpl(`https://push2.eastmoney.com/api/qt/stock/get?${params}`, { signal });
  if (!response.ok) throw new Error(`HTTP ${response.status} fetching quote for ${code}`);
  const body = await response.json();
  const data = body?.data;
  const quote = { code: normalizeCode(code) };
  if (data?.f58) quote.name = String(data.f58);
  const price = Number(data?.f43) / 100;
  if (Number.isFinite(price) && price > 0) quote.price = price;
  const preClose = Number(data?.f60) / 100;
  if (Number.isFinite(preClose) && preClose > 0) quote.preClose = preClose;
  const changePct = Number(data?.f170) / 100;
  if (Number.isFinite(changePct)) quote.changePct = changePct;
  return quote;
}

/**
 * Fetch quotes for many codes, bounded so a large portfolio cannot open a
 * hundred sockets at once.
 * @param {string[]} codes - Stock codes
 * @param {Object} [options] - `{ signal, fetchImpl, concurrency }`
 * @returns {Promise<Map<string, Object>>} code → quote; unreachable codes are absent
 */
async function fetchQuotes(codes, { signal, fetchImpl, concurrency = 6 } = {}) {
  const pending = [...new Set(codes.map(normalizeCode))];
  const found = new Map();
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, pending.length) }, async () => {
    while (next < pending.length) {
      const code = pending[next++];
      try {
        found.set(code, await fetchQuote(code, { signal, fetchImpl }));
      } catch {
        // One unreachable stock must not empty the whole portfolio view; the
        // caller reports it as a missing price rather than a zero.
      }
    }
  }));
  return found;
}

export { toSecid, normalizeCode, fetchQuote, fetchQuotes };
