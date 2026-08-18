/**
 * DSH Plugin: shared Tushare Pro access.
 *
 * Provides the `tushare` service so every finance plugin shares one token, one
 * per-interface quota gate, and one trading calendar. Without it each plugin
 * would ask the user for the same token again and meter its own quota, which
 * overspends the account's real per-minute budget.
 *
 * Registers no tools: nothing here is visible to the model.
 *
 * @module dsh-plugin-tushare
 */

import Schema from '@deepseek-ai/schemastery';
import { createQuery, createRateLimiter, TushareError, KIND } from './client.js';

/** Cordis plugin name used by loader diagnostics. */
const name = 'tushare';

/**
 * How Tushare gates each interface we use.
 *
 * `basic` interfaces come with an entry-level account; `points` interfaces
 * require a higher score. Tushare moves these thresholds, so this table is
 * documentation, never a gate — the authoritative answer is the access error,
 * which quotes the current requirement. Consumers use it to tell users up
 * front which tools need a paid-tier account.
 */
const INTERFACE_ACCESS = {
  trade_cal: 'basic',
  stock_basic: 'basic',
  daily: 'basic',
  daily_basic: 'points',
  income: 'points',
  balancesheet: 'points',
  cashflow: 'points',
  fina_indicator: 'points',
  express: 'points',
  moneyflow: 'points',
  top_list: 'points',
  hsgt_top10: 'points',
  moneyflow_hsgt: 'points',
  cb_basic: 'points',
  cb_daily: 'points',
  stk_holdernumber: 'points',
};

const Config = Schema.object({
  token: Schema.string().default('').description(
    'Tushare Pro API token(在 tushare.pro 注册后获取)。留空时依赖它的工具仍会注册,'
    + '但调用会明确报「未配置 token」,而不是静默消失。',
  ),
  endpoint: Schema.string().default('https://api.tushare.pro').description(
    'Tushare Pro API 端点。',
  ),
  maxPerMinute: Schema.number().default(450).description(
    '每个接口每分钟的请求上限。Tushare 按接口分别计量(daily 为 500/分钟),'
    + '而一次全市场窗口每个交易日一次请求,不设闸很容易在扫描中途超限。0 表示不限。',
  ),
  rateRetries: Schema.number().default(2).description(
    '遇到「频率超限」时的重试次数(退避 3s、6s…)。权限不足不会重试。',
  ),
});

/**
 * Provide the `tushare` service.
 * @param {Object} ctx - Plugin context
 * @param {Object} config - Validated config
 */
function apply(ctx, config = {}) {
  const limiter = createRateLimiter({ perMinute: config.maxPerMinute ?? 450 });
  const query = createQuery({
    token: config.token ?? '',
    endpoint: config.endpoint ?? 'https://api.tushare.pro',
    limiter,
    retries: config.rateRetries ?? 2,
  });

  ctx.provide('tushare', {
    /** True when a token is configured; tools can say so before failing. */
    configured: Boolean(config.token),
    /** How Tushare gates one interface: 'basic' | 'points' | undefined. */
    access: (apiName) => INTERFACE_ACCESS[apiName],
    /** Run one Tushare call; rejects with a classified {@link TushareError}. */
    query,
    /** Trading days ending at (and including) `endDate`, oldest first. */
    tradeDates: (options) => fetchTradeDates(query, options),
  });
}

/**
 * Trading days from the exchange calendar — windows are counted in trading
 * days, which calendar arithmetic cannot derive.
 * @param {Function} query - The bound query function
 * @param {Object} options - `{ endDate, count, signal }`
 * @returns {Promise<string[]>} Trading days ascending, at most `count`
 */
async function fetchTradeDates(query, { endDate, count, signal }) {
  // Over-reach the calendar range so `count` trading days are always covered:
  // ~250 trading days a year, plus a floor for very short windows.
  const spanDays = Math.ceil(count * 1.7) + 30;
  const end = Date.UTC(
    Number(endDate.slice(0, 4)), Number(endDate.slice(4, 6)) - 1, Number(endDate.slice(6, 8)),
  );
  const start = new Date(end - spanDays * 86_400_000);
  const startDate = [
    start.getUTCFullYear(),
    String(start.getUTCMonth() + 1).padStart(2, '0'),
    String(start.getUTCDate()).padStart(2, '0'),
  ].join('');
  const rows = await query({
    apiName: 'trade_cal',
    params: { exchange: 'SSE', start_date: startDate, end_date: endDate, is_open: '1' },
    fields: 'cal_date',
    signal,
  });
  return rows.map(row => String(row.cal_date)).sort().slice(-count);
}

export { apply, name, Config, INTERFACE_ACCESS, TushareError, KIND };
