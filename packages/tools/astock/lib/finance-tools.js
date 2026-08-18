/**
 * Tushare-backed A-share data tools: financial statements, money flow, and
 * convertible bonds.
 *
 * They live beside the free EastMoney tools in the same plugin because they
 * answer the same kind of question — "what are this market's numbers" — and a
 * user asking about a company should not have to know which of four plugins
 * holds which figure. What separates them is the credential, so every one of
 * them says in its own description that it needs a Tushare token and whether a
 * free tool can answer a weaker version of the question.
 *
 * @module dsh-plugin-astock/finance-tools
 */

import { defineTool } from '@deepseek-ai/dsh-tools';
import { assignFinite, finiteNumber } from './value.js';
import { toTsCode, fromTsCode } from './tushare.js';
import { shanghaiToday } from './value.js';

/**
 * Suffix appended to every Tushare-backed tool description.
 *
 * The model has to know the credential story BEFORE it calls: which tools need
 * a token, and where a free tool can answer a narrower version of the same
 * question. Discovering it from a failure wastes a turn, and — as observed in
 * a real run — an agent that only learns "the data is unavailable" is liable
 * to assemble numbers from somewhere else instead of reporting the gap.
 * @param {string} [free] - What the free fallback can do, if anything
 * @returns {string} The description suffix
 */
function tokenNote(free) {
  const base = '【数据源:Tushare Pro,需要已配置 token 的 dsh-plugin-tushare;该接口按积分开放】';
  return free
    ? `${base}【免费替代:${free}】`
    : `${base}【无免费替代:如果调用失败,如实告诉用户需要 Tushare 权限,不要用其他来源推断或编造】`;
}

/** `fina_indicator` columns → canonical names. */
const INDICATOR_FIELDS = {
  roe: 'roe', roe_dt: 'roeDeducted', roa: 'roa',
  grossprofit_margin: 'grossMargin', netprofit_margin: 'netMargin',
  debt_to_assets: 'debtToAssets', current_ratio: 'currentRatio', quick_ratio: 'quickRatio',
  assets_turn: 'assetTurnover', or_yoy: 'revenueYoy', netprofit_yoy: 'netIncomeYoy',
  eps: 'eps', bps: 'bps', ocfps: 'operatingCashFlowPerShare',
};

/** `income` columns → canonical names. */
const INCOME_FIELDS = {
  total_revenue: 'totalRevenue', revenue: 'revenue', oper_cost: 'operatingCost',
  sell_exp: 'sellingExpense', admin_exp: 'adminExpense', rd_exp: 'rdExpense',
  operate_profit: 'operatingProfit', total_profit: 'totalProfit',
  n_income: 'netIncome', n_income_attr_p: 'netIncomeAttrParent', basic_eps: 'basicEps',
};

/** `balancesheet` columns → canonical names. */
const BALANCE_FIELDS = {
  total_assets: 'totalAssets', total_liab: 'totalLiabilities',
  total_hldr_eqy_exc_min_int: 'equityExclMinority', money_cap: 'cash',
  accounts_receiv: 'accountsReceivable', inventories: 'inventories',
  total_cur_assets: 'currentAssets', total_cur_liab: 'currentLiabilities',
  st_borr: 'shortTermBorrowing', lt_borr: 'longTermBorrowing', goodwill: 'goodwill',
};

/** `cashflow` columns → canonical names. */
const CASHFLOW_FIELDS = {
  n_cashflow_act: 'operatingCashFlow', n_cashflow_inv_act: 'investingCashFlow',
  n_cash_flows_fnc_act: 'financingCashFlow', c_pay_acq_const_fiolta: 'capex',
};

const REPORTS = {
  indicators: { apiName: 'fina_indicator', fields: INDICATOR_FIELDS, label: '主要财务指标' },
  income: { apiName: 'income', fields: INCOME_FIELDS, label: '利润表' },
  balance: { apiName: 'balancesheet', fields: BALANCE_FIELDS, label: '资产负债表' },
  cashflow: { apiName: 'cashflow', fields: CASHFLOW_FIELDS, label: '现金流量表' },
};

/**
 * Map one period row through a field table.
 * @param {Object} row - Raw Tushare row
 * @param {Object} fields - snake_case → canonical name
 * @returns {Object} Canonical record; absent metrics omit their key entirely
 */
function mapPeriodRow(row, fields) {
  const record = {};
  const period = String(row?.end_date ?? '');
  if (/^\d{8}$/.test(period)) record.period = period;
  const numbers = {};
  for (const [field, key] of Object.entries(fields)) numbers[key] = row?.[field];
  return assignFinite(record, numbers);
}

/** @param {string} period - YYYYMMDD @returns {string} e.g. "2025 年报" */
function periodLabel(period) {
  const suffix = { '0331': '一季报', '0630': '中报', '0930': '三季报', '1231': '年报' }[period.slice(4)];
  return suffix ? `${period.slice(0, 4)} ${suffix}` : period;
}

/**
 * Register `astock_financials`.
 * @param {Object} ctx - Plugin context (already injected with `tushare`)
 * @param {Object} tushare - The tushare service
 */
function registerFinancialsTool(ctx, tushare) {
  ctx.systemPrompt.section({
    name: 'tool:astock_financials',
    order: 147,
    text: 'Use astock_financials for a listed company\'s reported numbers: ratios (ROE, margins, leverage, growth) or the income statement, balance sheet, or cash-flow statement, across recent reporting periods. Periods are quarterly cumulative (0331/0630/0930/1231). Requires a Tushare token.',
  });

  ctx.tools.register(defineTool({
    name: 'astock_financials',
    description: 'Fetch reported financials for one A-share company across recent reporting periods: key ratios, income statement, balance sheet, or cash-flow statement. '
      + tokenNote(),
    parameters: {
      code: { type: 'string', required: true, description: 'Stock code, e.g. "600519" or "600519.SH"' },
      report: {
        type: 'string', default: 'indicators',
        description: 'Which report: "indicators" (ROE/margins/leverage/growth), "income", "balance", "cashflow"',
      },
      periods: { type: 'number', default: 8, description: 'How many recent reporting periods to return (max 40)' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          code: { type: 'string' },
          report: { type: 'string' },
          count: { type: 'integer' },
          periods: {
            type: 'array', required: true,
            items: { type: 'object', additionalProperties: true, properties: { period: { type: 'string' } } },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: formatFinancialsOutput(value) }],
      presentationMeta: (_args, value) => ({ code: value.code, report: value.report, count: value.count }),
    },
    timeoutMs: 60000,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const spec = REPORTS[args.report ?? 'indicators'];
      if (!spec) {
        throw new Error(`Unknown report "${args.report}". Use one of: ${Object.keys(REPORTS).join(', ')}`);
      }
      const limit = Math.max(1, Math.min(Math.floor(args.periods ?? 8), 40));
      const rows = await tushare.query({
        apiName: spec.apiName,
        params: { ts_code: toTsCode(args.code), limit },
        fields: ['ts_code', 'end_date', ...Object.keys(spec.fields)].join(','),
        signal: exec.signal,
      });
      const periods = rows
        .map(row => mapPeriodRow(row, spec.fields))
        .filter(record => record.period !== undefined)
        .sort((a, b) => a.period.localeCompare(b.period));
      return { code: fromTsCode(toTsCode(args.code)), report: args.report ?? 'indicators', count: periods.length, periods };
    },
    presentCall: (args) => ({
      card: 'generic', title: `${args.code} ${REPORTS[args.report ?? 'indicators']?.label ?? '财务'}`,
      kind: 'stock-financials', rawInput: args.code,
    }),
    presentResult: (args, result) => (result.isError ? undefined : {
      card: 'generic', title: `${args.code} 财务(${result.count} 期)`, kind: 'stock-financials', count: result.count,
    }),
  }));
}

/** Model-facing summary: latest period in full, older ones as a trend line. */
function formatFinancialsOutput(value) {
  const periods = value.periods ?? [];
  if (periods.length === 0) return `${value.code}:未取到财务数据(可能是新股或该报表尚未披露)。`;
  const label = REPORTS[value.report]?.label ?? value.report;
  const latest = periods[periods.length - 1];
  const lines = [`${value.code} ${label} — ${value.count} 期(${periodLabel(periods[0].period)} → ${periodLabel(latest.period)})`, ''];
  lines.push(`最新一期 ${periodLabel(latest.period)}:`);
  for (const [key, raw] of Object.entries(latest)) {
    if (key === 'period') continue;
    const number = finiteNumber(raw);
    if (number === undefined) continue;
    lines.push(`  ${key}: ${Math.abs(number) >= 1e8 ? (number / 1e8).toFixed(2) + '亿' : number.toFixed(4)}`);
  }
  lines.push('', '全部期数在规范值 periods[] 里(按期升序),趋势分析请在 Code Mode 中计算。');
  return lines.join('\n');
}

/** `moneyflow` columns → canonical names (amounts in 万元, volumes in 手). */
const STOCK_FLOW_FIELDS = {
  buy_sm_amount: 'buySmall', sell_sm_amount: 'sellSmall',
  buy_md_amount: 'buyMedium', sell_md_amount: 'sellMedium',
  buy_lg_amount: 'buyLarge', sell_lg_amount: 'sellLarge',
  buy_elg_amount: 'buyExtraLarge', sell_elg_amount: 'sellExtraLarge',
  net_mf_amount: 'netAmount',
};

/** `moneyflow_hsgt` columns → canonical names (amounts in 万元). */
const NORTH_FLOW_FIELDS = {
  hgt: 'huguTong', sgt: 'shenguTong', ggt_ss: 'ggtShanghai', ggt_sz: 'ggtShenzhen',
  north_money: 'northMoney', south_money: 'southMoney',
};

/** `top_list` columns → canonical names. */
const TOP_LIST_FIELDS = {
  close: 'close', pct_change: 'pctChange', turnover_rate: 'turnoverRate',
  amount: 'amount', l_buy: 'listBuy', l_sell: 'listSell', net_amount: 'netAmount',
};

const FLOW_SCOPES = {
  stock: { apiName: 'moneyflow', fields: STOCK_FLOW_FIELDS, label: '个股资金流' },
  north: { apiName: 'moneyflow_hsgt', fields: NORTH_FLOW_FIELDS, label: '北向/南向资金' },
  toplist: { apiName: 'top_list', fields: TOP_LIST_FIELDS, label: '龙虎榜' },
};

/**
 * Register `astock_moneyflow`.
 *
 * One tool with a `scope` rather than three: they answer the same question at
 * different aggregations, and every registered tool spends system-prompt
 * budget on every request, whether or not anyone asks about flows today.
 * @param {Object} ctx - Plugin context (already injected with `tushare`)
 * @param {Object} tushare - The tushare service
 */
function registerMoneyflowTool(ctx, tushare) {
  ctx.systemPrompt.section({
    name: 'tool:astock_moneyflow',
    order: 148,
    text: 'Use astock_moneyflow for where the money went: one stock’s buy/sell split by order size (scope "stock"), northbound/southbound Stock Connect flows (scope "north"), or the day’s 龙虎榜 disclosure list (scope "toplist"). Amounts are in 万元. Requires a Tushare token.',
  });

  ctx.tools.register(defineTool({
    name: 'astock_moneyflow',
    description: 'Fetch A-share money flow: per-stock buy/sell split by order size, northbound/southbound Stock Connect totals, or the daily 龙虎榜 (top-list) disclosures. Amounts in 万元. '
      + tokenNote(),
    parameters: {
      scope: {
        type: 'string', default: 'stock',
        description: '"stock" (needs code), "north" (market-wide Stock Connect), or "toplist" (needs tradeDate)',
      },
      code: { type: 'string', default: '', description: 'Stock code, required when scope is "stock"' },
      tradeDate: { type: 'string', default: '', description: 'Trading day YYYYMMDD; required for "toplist", optional elsewhere' },
      days: { type: 'number', default: 10, description: 'How many recent rows to return for "stock" and "north"' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          scope: { type: 'string' },
          code: { type: 'string' },
          count: { type: 'integer' },
          rows: {
            type: 'array', required: true,
            items: {
              type: 'object', additionalProperties: true,
              properties: { date: { type: 'string' }, code: { type: 'string' }, name: { type: 'string' } },
            },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: formatMoneyflowOutput(value) }],
      presentationMeta: (_args, value) => ({ scope: value.scope, count: value.count }),
    },
    timeoutMs: 60000,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const scope = args.scope ?? 'stock';
      const spec = FLOW_SCOPES[scope];
      if (!spec) throw new Error(`Unknown scope "${scope}". Use one of: ${Object.keys(FLOW_SCOPES).join(', ')}`);
      const params = {};
      if (scope === 'stock') {
        if (!args.code) throw new Error('scope "stock" needs a `code`');
        params.ts_code = toTsCode(args.code);
        params.limit = Math.max(1, Math.min(Math.floor(args.days ?? 10), 200));
      } else if (scope === 'toplist') {
        if (!args.tradeDate) throw new Error('scope "toplist" needs a `tradeDate` (YYYYMMDD)');
        params.trade_date = args.tradeDate;
      } else {
        // moneyflow_hsgt rejects `limit`; it windows by date, so the calendar
        // has to resolve the window first.
        const days = Math.max(1, Math.min(Math.floor(args.days ?? 10), 200));
        const window = await tushare.tradeDates({
          endDate: args.tradeDate || shanghaiToday(), count: days, signal: exec.signal,
        });
        if (window.length === 0) throw new Error('Could not resolve a trading-day window for Stock Connect flows');
        params.start_date = window[0];
        params.end_date = window[window.length - 1];
      }
      if (args.tradeDate && scope === 'stock') params.trade_date = args.tradeDate;

      const extra = scope === 'toplist' ? ['ts_code', 'name', 'reason'] : scope === 'stock' ? ['ts_code'] : [];
      const rows = await tushare.query({
        apiName: spec.apiName,
        params,
        fields: ['trade_date', ...extra, ...Object.keys(spec.fields)].join(','),
        signal: exec.signal,
      });
      const mapped = rows.map(row => {
        const record = {};
        const date = String(row.trade_date ?? '');
        if (/^\d{8}$/.test(date)) record.date = date;
        if (row.ts_code) record.code = fromTsCode(row.ts_code);
        if (row.name) record.name = String(row.name);
        if (row.reason) record.reason = String(row.reason);
        const numbers = {};
        for (const [field, key] of Object.entries(spec.fields)) numbers[key] = row[field];
        return assignFinite(record, numbers);
      }).sort((a, b) => String(a.date ?? '').localeCompare(String(b.date ?? '')));
      return { scope, code: args.code ? fromTsCode(toTsCode(args.code)) : '', count: mapped.length, rows: mapped };
    },
    presentCall: (args) => ({
      card: 'generic',
      title: `${FLOW_SCOPES[args.scope ?? 'stock']?.label ?? '资金流'}${args.code ? ' ' + args.code : ''}`,
      kind: 'stock-moneyflow', rawInput: args.code || args.tradeDate,
    }),
    presentResult: (_args, result) => (result.isError ? undefined : {
      card: 'generic', title: `${FLOW_SCOPES[result.scope]?.label ?? '资金流'}(${result.count} 行)`,
      kind: 'stock-moneyflow', count: result.count,
    }),
  }));
}

/** Model-facing summary; the rows stay in the canonical value. */
function formatMoneyflowOutput(value) {
  const rows = value.rows ?? [];
  const label = FLOW_SCOPES[value.scope]?.label ?? value.scope;
  if (rows.length === 0) return `${label}:该范围内没有数据(可能是非交易日,或当日无龙虎榜)。`;
  const lines = [`${label}${value.code ? ' ' + value.code : ''}:${value.count} 行,金额单位万元。`];
  for (const row of rows.slice(-5)) {
    const bits = [row.date ?? '', row.code ?? '', row.name ?? ''].filter(Boolean).join(' ');
    const net = row.netAmount ?? row.northMoney;
    lines.push(`  ${bits} ${net === undefined ? '' : '净额=' + net.toFixed(0) + '万'}${row.reason ? ' ' + row.reason : ''}`);
  }
  if (rows.length > 5) lines.push(`  …(共 ${rows.length} 行,全部在规范值 rows[] 里)`);
  return lines.join('\n');
}

/**
 * Register `astock_convertible_bonds`.
 *
 * Convertible bonds are quoted as bonds but priced off the underlying share,
 * so the number that decides everything — conversion premium — exists in
 * neither interface alone. This tool joins the bond quote, the bond's terms,
 * and the underlying's close for the same day, and computes it, because
 * leaving that join to the model invites a plausible-looking wrong answer.
 * @param {Object} ctx - Plugin context (already injected with `tushare`)
 * @param {Object} tushare - The tushare service
 */
function registerConvertibleBondsTool(ctx, tushare) {
  ctx.systemPrompt.section({
    name: 'tool:astock_convertible_bonds',
    order: 149,
    text: 'Use astock_convertible_bonds for the convertible-bond market: every bond trading on a given day with its price, conversion price, conversion value and conversion premium, or one bond by code. Premium = bond price / conversion value − 1, where conversion value = 100 / conversion price × underlying close. Requires a Tushare token.',
  });

  ctx.tools.register(defineTool({
    name: 'astock_convertible_bonds',
    description: 'Fetch A-share convertible bonds for a trading day: price, terms (conversion price, maturity, remaining size), conversion value and conversion premium, plus the underlying stock. Omit `code` for the whole market. '
      + tokenNote(),
    parameters: {
      tradeDate: {
        type: 'string', default: '',
        description: 'Trading day YYYYMMDD. Empty uses the latest trading day.',
      },
      code: {
        type: 'string', default: '',
        description: 'Bond code, e.g. "113050" or "113050.SH". Empty returns every bond trading that day.',
      },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          tradeDate: { type: 'string' },
          count: { type: 'integer' },
          bonds: {
            type: 'array', required: true,
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                code: { type: 'string' },
                name: { type: 'string' },
                stockCode: { type: 'string', description: 'Underlying stock code' },
                stockName: { type: 'string' },
                close: { type: 'number', description: 'Bond close, per 100 face value' },
                pctChg: { type: 'number' },
                convPrice: { type: 'number', description: 'Conversion price in 元' },
                convValue: { type: 'number', description: '100 / convPrice × underlying close' },
                convPremium: { type: 'number', description: 'close / convValue − 1' },
                stockClose: { type: 'number' },
                bondValue: { type: 'number', description: 'Pure-bond value from Tushare' },
                remainSize: { type: 'number', description: 'Outstanding size in 元' },
                maturityDate: { type: 'string' },
                amount: { type: 'number', description: 'Turnover in 千元' },
              },
            },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: formatBondsOutput(value) }],
      presentationMeta: (_args, value) => ({ tradeDate: value.tradeDate, count: value.count }),
    },
    timeoutMs: 90000,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const signal = exec.signal;
      const tradeDate = args.tradeDate
        || (await tushare.tradeDates({ endDate: shanghaiToday(), count: 1, signal }))[0];
      if (!tradeDate) throw new Error('Could not resolve a trading day for the convertible-bond snapshot');

      const quoteParams = { trade_date: tradeDate };
      if (args.code) quoteParams.ts_code = toTsCode(args.code, 'bond');
      const quotes = await tushare.query({
        apiName: 'cb_daily', params: quoteParams,
        fields: 'ts_code,trade_date,close,pct_chg,amount,bond_value',
        signal,
      });
      if (quotes.length === 0) {
        return { tradeDate, count: 0, bonds: [] };
      }

      const terms = await tushare.query({
        apiName: 'cb_basic', params: args.code ? { ts_code: toTsCode(args.code, 'bond') } : {},
        fields: 'ts_code,bond_short_name,stk_code,stk_short_name,conv_price,remain_size,maturity_date',
        signal,
      });
      const termsByCode = new Map(terms.map(row => [String(row.ts_code), row]));

      // One whole-market call covers every underlying, whatever the bond count.
      const underlying = await tushare.query({
        apiName: 'daily', params: { trade_date: tradeDate }, fields: 'ts_code,close', signal,
      });
      const closeByStock = new Map(underlying.map(row => [String(row.ts_code), finiteNumber(row.close)]));

      const bonds = quotes.map(quote => {
        const tsCode = String(quote.ts_code);
        const term = termsByCode.get(tsCode) ?? {};
        const bond = { code: fromTsCode(tsCode) };
        if (term.bond_short_name) bond.name = String(term.bond_short_name);
        if (term.stk_code) {
          bond.stockCode = fromTsCode(term.stk_code);
          const stockClose = closeByStock.get(String(term.stk_code));
          if (stockClose !== undefined) bond.stockClose = stockClose;
        }
        if (term.stk_short_name) bond.stockName = String(term.stk_short_name);
        if (term.maturity_date) bond.maturityDate = String(term.maturity_date);
        assignFinite(bond, {
          close: quote.close, pctChg: quote.pct_chg, amount: quote.amount,
          bondValue: quote.bond_value, convPrice: term.conv_price, remainSize: term.remain_size,
        });
        // Conversion value only exists once both legs are known; a bond in its
        // pre-conversion window legitimately has neither.
        if (bond.convPrice > 0 && bond.stockClose !== undefined) {
          const convValue = (100 / bond.convPrice) * bond.stockClose;
          if (Number.isFinite(convValue) && convValue > 0) {
            bond.convValue = convValue;
            if (bond.close !== undefined) bond.convPremium = bond.close / convValue - 1;
          }
        }
        return bond;
      }).sort((a, b) => a.code.localeCompare(b.code));

      return { tradeDate, count: bonds.length, bonds };
    },
    presentCall: (args) => ({
      card: 'generic', title: args.code ? `可转债 ${args.code}` : '可转债全市场',
      kind: 'stock-bonds', rawInput: args.code || args.tradeDate,
    }),
    presentResult: (_args, result) => (result.isError ? undefined : {
      card: 'generic', title: `可转债 ${result.tradeDate}(${result.count} 只)`,
      kind: 'stock-bonds', count: result.count,
    }),
  }));
}

/** Model-facing summary; the rows stay in the canonical value for Code Mode. */
function formatBondsOutput(value) {
  const bonds = value.bonds ?? [];
  if (bonds.length === 0) return `可转债 ${value.tradeDate}:没有数据(可能不是交易日,或该代码当日无成交)。`;
  const lines = [`可转债 ${value.tradeDate}:${value.count} 只。`];
  const priced = bonds.filter(bond => bond.convPremium !== undefined);
  if (priced.length > 0) {
    const cheapest = [...priced].sort((a, b) => a.convPremium - b.convPremium).slice(0, 3);
    lines.push('转股溢价率最低的几只:');
    for (const bond of cheapest) {
      lines.push(`  ${bond.code} ${bond.name ?? ''} 价=${bond.close?.toFixed(2)} `
        + `溢价率=${(bond.convPremium * 100).toFixed(2)}% 正股=${bond.stockName ?? bond.stockCode ?? ''}`);
    }
  }
  if (bonds.length > 3) {
    lines.push('每只含 code/name/stockCode/close/convPrice/convValue/convPremium/bondValue/remainSize/maturityDate,'
      + '筛选请在 Code Mode 中对 bonds[] 过滤。');
  }
  return lines.join('\n');
}

export {
  registerFinancialsTool, registerMoneyflowTool, registerConvertibleBondsTool, tokenNote, mapPeriodRow, periodLabel,
  FLOW_SCOPES, STOCK_FLOW_FIELDS, NORTH_FLOW_FIELDS, TOP_LIST_FIELDS,
  REPORTS, INDICATOR_FIELDS, INCOME_FIELDS, BALANCE_FIELDS, CASHFLOW_FIELDS,
};
