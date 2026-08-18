/**
 * Information-side sources: what was said about a company, not what it traded
 * at.
 *
 * Every source here is one Tushare interface reshaped into a canonical record.
 * Two rules run through all of them. Text fields are passed through verbatim
 * rather than summarized, because a headline the plugin paraphrases is a
 * headline the model can no longer quote. And a field the issuer left empty
 * stays absent, never an empty string standing in for "nothing was disclosed".
 *
 * @module dsh-plugin-ainfo/sources
 */

import { assignFinite } from 'dsh-plugin-tushare';

/** Plain six-digit code from a Tushare ts_code. */
function fromTsCode(tsCode) {
  return String(tsCode ?? '').split('.')[0];
}

/** Tushare ts_code from a loose A-share code. */
function toTsCode(code) {
  let clean = String(code).replace(/^(sh|sz|bj)/i, '').replace(/\.(SH|SZ|BJ)$/i, '');
  while (clean.length < 6) clean = '0' + clean;
  const table = { '6': 'SH', '5': 'SH', '9': 'SH', '0': 'SZ', '3': 'SZ', '2': 'SZ', '4': 'BJ', '8': 'BJ' };
  return `${clean}.${table[clean[0]] ?? 'SH'}`;
}

/** Copy the non-empty strings of `source` onto `target`. */
function assignText(target, source) {
  for (const [key, raw] of Object.entries(source)) {
    if (raw === null || raw === undefined) continue;
    const text = String(raw).trim();
    if (text !== '') target[key] = text;
  }
  return target;
}

/**
 * Tushare timestamps arrive as `YYYY-MM-DD HH:MM:SS` in some interfaces and
 * `YYYYMMDD` in others. Callers filter and sort on this, so it is normalized
 * to one shape rather than left to the consumer to guess.
 * @param {*} raw - Raw timestamp
 * @returns {string|undefined} `YYYY-MM-DD HH:MM:SS` or `YYYYMMDD`, else undefined
 */
function normalizeTime(raw) {
  const text = String(raw ?? '').trim();
  if (text === '') return undefined;
  if (/^\d{8}$/.test(text)) return text;
  if (/^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2})?)?$/.test(text)) return text.replace('T', ' ');
  return text;
}

/**
 * A readable excerpt from a news body.
 *
 * The feed ships article HTML, ad wrappers and all, so a naive slice spends
 * its whole budget on `<div class="article-content-left">` and shows the
 * model no text. Tags are stripped and whitespace collapsed before the cut,
 * which is also why the excerpt is bounded at all: full bodies would turn a
 * whole-day pull into megabytes nobody reads.
 * @param {*} raw - Raw content field
 * @returns {string|undefined} A bounded plain-text excerpt, or undefined
 */
function plainExcerpt(raw) {
  if (raw === null || raw === undefined) return undefined;
  const text = String(raw)
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
  return text === '' ? undefined : text.slice(0, 300);
}

/** `major_news` row → canonical record. */
function mapNews(row) {
  const record = {};
  assignText(record, { title: row.title, source: row.src, url: row.url });
  const time = normalizeTime(row.pub_time);
  if (time) record.time = time;
  const excerpt = plainExcerpt(row.content);
  if (excerpt) record.excerpt = excerpt;
  return record;
}

/** `report_rc` row → canonical record (broker research ratings). */
function mapResearch(row) {
  const record = { code: fromTsCode(row.ts_code) };
  assignText(record, {
    name: row.name, org: row.org_name, author: row.author_name,
    rating: row.rating, reportTitle: row.report_title, reportType: row.report_type,
  });
  const date = normalizeTime(row.report_date);
  if (date) record.date = date;
  return assignFinite(record, {
    targetPrice: row.target_price,
    minTargetPrice: row.min_price,
    maxTargetPrice: row.max_price,
    epsForecastY0: row.eps_2022 ?? row.eps,
  });
}

/** `forecast` row → canonical record (earnings pre-announcements). */
function mapForecast(row) {
  const record = { code: fromTsCode(row.ts_code) };
  assignText(record, { type: row.type, summary: row.summary, reason: row.change_reason });
  for (const [key, raw] of [['annDate', row.ann_date], ['period', row.end_date]]) {
    const value = normalizeTime(raw);
    if (value) record[key] = value;
  }
  return assignFinite(record, {
    changeMin: row.p_change_min, changeMax: row.p_change_max,
    netProfitMin: row.net_profit_min, netProfitMax: row.net_profit_max,
    lastYearNetProfit: row.last_parent_net,
  });
}

/** `dividend` row → canonical record. */
function mapDividend(row) {
  const record = { code: fromTsCode(row.ts_code) };
  assignText(record, { status: row.div_proc });
  for (const [key, raw] of [
    ['period', row.end_date], ['annDate', row.ann_date],
    ['recordDate', row.record_date], ['exDate', row.ex_date], ['payDate', row.pay_date],
  ]) {
    const value = normalizeTime(raw);
    if (value) record[key] = value;
  }
  return assignFinite(record, {
    cashDividend: row.cash_div, cashDividendPreTax: row.cash_div_tax,
    stockDividend: row.stk_div, capitalizationRatio: row.stk_co_div,
  });
}

/** `stk_holdertrade` row → canonical record (insider buying and selling). */
function mapHolderTrade(row) {
  const record = { code: fromTsCode(row.ts_code) };
  assignText(record, {
    holder: row.holder_name, holderType: row.holder_type,
    direction: row.in_de === 'IN' ? 'increase' : row.in_de === 'DE' ? 'decrease' : undefined,
  });
  const date = normalizeTime(row.ann_date);
  if (date) record.annDate = date;
  return assignFinite(record, {
    changeVolume: row.change_vol, changeRatio: row.change_ratio,
    afterShare: row.after_share, afterRatio: row.after_ratio,
    averagePrice: row.avg_price,
  });
}

/** `share_float` row → canonical record (lock-up expiries). */
function mapShareFloat(row) {
  const record = { code: fromTsCode(row.ts_code) };
  assignText(record, { holder: row.holder_name, shareType: row.share_type });
  const date = normalizeTime(row.float_date);
  if (date) record.floatDate = date;
  return assignFinite(record, { floatShare: row.float_share, floatRatio: row.float_ratio });
}

/** `top10_holders` row → canonical record. */
function mapTopHolder(row) {
  const record = { code: fromTsCode(row.ts_code) };
  assignText(record, { holder: row.holder_name });
  const period = normalizeTime(row.end_date);
  if (period) record.period = period;
  return assignFinite(record, { holdAmount: row.hold_amount, holdRatio: row.hold_ratio });
}

export {
  fromTsCode, toTsCode, assignText, normalizeTime, plainExcerpt,
  mapNews, mapResearch, mapForecast, mapDividend, mapHolderTrade, mapShareFloat, mapTopHolder,
};
