/**
 * A-share stock data fetching from public APIs.
 * Uses EastMoney (东方财富) public APIs for K-line data.
 *
 * @module dsh-plugin-astock/data
 */

import { assignFinite } from './value.js';

/**
 * Stock market prefixes
 * 0 = Shenzhen (SZ)
 * 1 = Shanghai (SH)
 * 2 = Beijing (BJ)
 */
const MARKET_PREFIX = {
  '6': '1',   // 60xxxx → Shanghai
  '5': '1',   // 51xxxx → Shanghai (funds)
  '9': '1',   // 9xxxxx → Shanghai (B shares)
  '0': '0',   // 00xxxx → Shenzhen
  '3': '0',   // 30xxxx → Shenzhen (ChiNext/创业板)
  '2': '0',   // 20xxxx → Shenzhen (B shares)
  '4': '2',   // 4xxxxx → Beijing
  '8': '2',   // 8xxxxx → Beijing
};

/**
 * Normalize stock code to EastMoney format (market code + stock code)
 * @param {string} code - Stock code like "000001" or "sh000001" or "sz000001"
 * @returns {string} Normalized code like "1.000001"
 */
function normalizeCode(code) {
  // Remove any prefix like "sh", "sz", "bj"
  let clean = code.replace(/^(sh|sz|bj|SH|SZ|BJ)/i, '');
  
  const firstChar = clean[0];
  const market = MARKET_PREFIX[firstChar] || '1';
  
  // Pad to 6 digits
  while (clean.length < 6) {
    clean = '0' + clean;
  }
  
  return `${market}.${clean}`;
}

/**
 * Get the market prefix for display
 * @param {string} code - Stock code
 * @returns {string} Market prefix (SH/SZ/BJ)
 */
function getMarketPrefix(code) {
  const clean = code.replace(/^(sh|sz|bj|SH|SZ|BJ)/i, '').padStart(6, '0');
  const firstChar = clean[0];
  const market = MARKET_PREFIX[firstChar] || '1';
  
  if (market === '1') return 'SH';
  if (market === '0') return 'SZ';
  if (market === '2') return 'BJ';
  return 'SH';
}

/**
 * K-line period mapping for EastMoney API
 */
const PERIOD_MAP = {
  'daily': '101',
  'weekly': '102',
  'monthly': '103',
  'yearly': '104',
  '5min': '5',
  '15min': '15',
  '30min': '30',
  '60min': '60',
};

/**
 * K-line period descriptions in Chinese
 */
const PERIOD_NAMES = {
  'daily': '日K线',
  'weekly': '周K线',
  'monthly': '月K线',
  'yearly': '年K线',
  '5min': '5分钟K线',
  '15min': '15分钟K线',
  '30min': '30分钟K线',
  '60min': '60分钟K线',
};

/**
 * Fetch K-line (candlestick) data from EastMoney API
 * @param {string} code - Stock code (e.g., "000001", "sh000001", "600519")
 * @param {Object} [options] - Options
 * @param {string} [options.period='daily'] - K-line period: daily, weekly, monthly, yearly, 5min, 15min, 30min, 60min
 * @param {number} [options.limit=100] - Number of K-lines to fetch (max 1000)
 * @param {boolean} [options.fq=true] - Whether to use复权 (adjusted) data: true=前复权, false=不复权
 * @param {string} [options.beginDate] - Start date in YYYYMMDD format
 * @param {string} [options.endDate] - End date in YYYYMMDD format
 * @returns {Promise<Object>} K-line data
 */
async function fetchKline(code, options = {}) {
  const {
    period = 'daily',
    limit = 100,
    fq = true,
    beginDate,
    endDate,
  } = options;

  const secid = normalizeCode(code);
  const periodValue = PERIOD_MAP[period];
  
  if (!periodValue) {
    throw new Error(`Invalid period: ${period}. Supported: ${Object.keys(PERIOD_MAP).join(', ')}`);
  }

  // Build URL
  const params = new URLSearchParams({
    fields1: 'f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f12,f13',
    fields2: 'f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61',
    ut: '7eea3edcaed734bea9c758c1c0a6f0b3',
    klt: periodValue,
    fqt: fq ? '1' : '0',
    secid: secid,
    beg: beginDate || '0',
    end: endDate || '20500000',
    lmt: Math.min(limit, 1000),
  });

  const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get?${params.toString()}`;
  
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: Failed to fetch K-line data for ${code}`);
  }
  
  const data = await response.json();
  
  if (!data || data.data === null) {
    throw new Error(`No data found for stock code: ${code}. Please check the code and try again.`);
  }
  
  const klineData = data.data;
  // EastMoney ignores `lmt` when the range is open-ended (`beg=0`), answering
  // with the stock's WHOLE history — 5,985 bars for a 2001 listing where the
  // caller asked for 30. The renderer only shows the tail, so the excess was
  // invisible while every call still carried it into the canonical value and,
  // in Code Mode, across the worker boundary. Enforce the bound here: the
  // caller's `limit` is a promise this module makes, not one the API keeps.
  const bound = Math.max(1, Math.min(Math.floor(limit), 1000));
  const parsed = (klineData.klines || []).map(line => parseKline(line));
  const klines = parsed.slice(-bound);
  
  return {
    code: code,
    name: klineData.name || '',
    market: getMarketPrefix(code),
    period: period,
    periodName: PERIOD_NAMES[period] || period,
    total: klines.length,
    klines: klines,
  };
}

/**
 * Parse a single K-line string from EastMoney API
 * Format: "2024-01-15,open,close,high,low,volume,amount,amplitude,changePct,change, turnoverRate"
 * @param {string} line - Raw K-line string
 * @returns {Object} Parsed K-line
 */
function parseKline(line) {
  const parts = line.split(',');
  
  return {
    date: parts[0],
    open: parseFloat(parts[1]),
    close: parseFloat(parts[2]),
    high: parseFloat(parts[3]),
    low: parseFloat(parts[4]),
    volume: parseFloat(parts[5]),      // Volume in shares
    amount: parseFloat(parts[6]),       // Turnover in yuan
    amplitude: parseFloat(parts[7] || 0), // Amplitude %
    changePct: parseFloat(parts[8] || 0), // Change %
    change: parseFloat(parts[9] || 0),    // Change amount
    turnoverRate: parseFloat(parts[10] || 0), // Turnover rate %
  };
}

/**
 * Fetch real-time stock quote
 * @param {string} code - Stock code
 * @returns {Promise<Object>} Real-time quote
 */
async function fetchQuote(code) {
  const secid = normalizeCode(code);
  
  const params = new URLSearchParams({
    secid: secid,
    ut: '7eea3edcaed734bea9c758c1c0a6f0b3',
    fields: 'f43,f44,f45,f46,f47,f48,f49,f50,f51,f52,f57,f58,f59,f60,f61,f62,f63,f64,f65,f116,f117,f162,f167,f168,f169,f170,f171',
  });
  
  const url = `https://push2.eastmoney.com/api/qt/stock/get?${params.toString()}`;
  
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: Failed to fetch quote for ${code}`);
  }
  
  const data = await response.json();
  
  if (!data || data.data === null) {
    throw new Error(`No quote data found for stock code: ${code}`);
  }
  
  return mapQuote(code, data.data);
}

/**
 * Map an EastMoney quote payload to the tool's canonical quote value.
 * Pure function, exported for unit tests. EastMoney reports missing numbers
 * as "-" (e.g. pe for loss-making stocks); arithmetic on those yields NaN,
 * which is not lossless JSON — such fields are omitted so the value stays
 * valid under the tool's closed (additionalProperties: false) output schema.
 * @param {string} code - Normalized display stock code
 * @param {Object} d - `data` object from the EastMoney quote API
 * @returns {Object} Canonical quote value
 */
function mapQuote(code, d) {
  // EastMoney quote API returns prices in "cents" (分, i.e., 1/100 yuan)
  const priceDivisor = 100;

  const numeric = {
    open: d.f46 / priceDivisor,
    high: d.f44 / priceDivisor,
    low: d.f45 / priceDivisor,
    price: d.f43 / priceDivisor,
    preClose: d.f60 / priceDivisor,
    volume: d.f47,
    amount: d.f48,
    highLimit: d.f51 / priceDivisor,
    lowLimit: d.f52 / priceDivisor,
    change: d.f169 / priceDivisor,
    changePct: d.f170 / priceDivisor,
    turnoverRate: d.f168 / priceDivisor,
    amplitude: d.f171 / priceDivisor,
    pe: d.f162 / priceDivisor,
    totalMarketCap: d.f116,
    circulatingMarketCap: d.f117,
  };

  return assignFinite({
    code: code,
    name: d.f58 || '',
    market: getMarketPrefix(code),
  }, numeric);
}

/**
 * Search stocks by keyword
 * @param {string} keyword - Search keyword (stock code, name, pinyin)
 * @returns {Promise<Array>} Matching stocks
 */
async function searchStocks(keyword) {
  // EastMoney search API
  const params = new URLSearchParams({
    input: keyword,
    count: '20',
    type: '14',
  });
  
  const url = `https://searchadapter.eastmoney.com/api/suggest/get?${params.toString()}`;
  
  const response = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: Failed to search stocks`);
  }
  
  const data = await response.json();
  const stocks = data?.QuotationCodeTable?.Data || [];
  
  if (!Array.isArray(stocks)) {
    return [];
  }
  
  return stocks.map(s => ({
    code: s.Code || s.code || '',
    name: s.Name || s.name || '',
    market: s.MarketType || s.Market || s.market || '',
    type: s.SecurityTypeName || s.Type || s.type || '',
  }));
}

export {
  fetchKline,
  fetchQuote,
  mapQuote,
  searchStocks,
  normalizeCode,
  getMarketPrefix,
  PERIOD_MAP,
  PERIOD_NAMES,
};