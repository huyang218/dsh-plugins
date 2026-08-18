/**
 * DSH Plugin: A-share information side.
 *
 * Where `dsh-plugin-astock` answers what the market did, this answers what was
 * said about it: news, broker research, earnings pre-announcements, dividends,
 * insider trading, lock-up expiries and the shareholder register.
 *
 * Separate from the data plugin because the questions are separate — an agent
 * screening for a 40-day low needs none of this, and every registered tool
 * spends system-prompt budget on every request whether or not it is used.
 *
 * Every tool here needs a Tushare Pro token through `dsh-plugin-tushare`.
 * There is no free source for this material, so each tool says so, and a
 * refusal is reported rather than worked around.
 *
 * @module dsh-plugin-ainfo
 */

import { defineTool } from '@deepseek-ai/dsh-tools';
import {
  toTsCode, mapNews, mapResearch, mapForecast, mapDividend,
  mapHolderTrade, mapShareFloat, mapTopHolder,
} from './sources.js';

/** Cordis plugin name used by loader diagnostics. */
const name = 'ainfo';

/** Services required before `apply` runs. */
const inject = ['tools', 'systemPrompt'];

/** Suffix stating the credential on every tool description. */
const TOKEN_NOTE = '【数据源:Tushare Pro,需要已配置 token 的 dsh-plugin-tushare;该接口按积分开放】'
  + '【无免费替代:调用失败时如实告诉用户需要 Tushare 权限,不要用其他来源推断或编造】';

/** Per-company event sources behind `ainfo_events`. */
const EVENT_KINDS = {
  forecast: {
    apiName: 'forecast', map: mapForecast, label: '业绩预告',
    fields: 'ts_code,ann_date,end_date,type,p_change_min,p_change_max,net_profit_min,net_profit_max,last_parent_net,summary,change_reason',
  },
  dividend: {
    apiName: 'dividend', map: mapDividend, label: '分红送股',
    fields: 'ts_code,end_date,ann_date,div_proc,stk_div,cash_div,cash_div_tax,record_date,ex_date,pay_date',
  },
  holdertrade: {
    apiName: 'stk_holdertrade', map: mapHolderTrade, label: '股东增减持',
    fields: 'ts_code,ann_date,holder_name,holder_type,in_de,change_vol,change_ratio,after_share,after_ratio,avg_price',
  },
  float: {
    apiName: 'share_float', map: mapShareFloat, label: '限售解禁',
    fields: 'ts_code,float_date,float_share,float_ratio,holder_name,share_type',
  },
  holders: {
    apiName: 'top10_holders', map: mapTopHolder, label: '十大股东',
    fields: 'ts_code,end_date,holder_name,hold_amount,hold_ratio',
  },
};

/**
 * Register the information-side tools.
 * @param {Object} ctx - Plugin context
 */
function apply(ctx) {
  // Registered unconditionally so the model can explain an absent tool rather
  // than treat the capability as nonexistent.
  ctx.systemPrompt.section({
    name: 'ainfo:data-sources',
    order: 150,
    text: [
      'ainfo covers the A-share INFORMATION side: news, broker research, earnings',
      'pre-announcements, dividends, insider trading, lock-up expiries, shareholders.',
      'Market prices, indicators and screening live in the astock tools instead.',
      'Every ainfo tool requires a Tushare Pro token via the dsh-plugin-tushare plugin,',
      'and Tushare gates interfaces by account points. If these tools are missing, that',
      'plugin is not installed — say so. If a call fails with a permission or token error,',
      'report exactly that. The information is then unavailable: do NOT substitute another',
      'source, guess, or present remembered facts as current.',
    ].join('\n'),
  });

  ctx.inject(['tushare'], (tushareCtx) => {
    const tushare = tushareCtx.tushare;
    registerNewsTool(tushareCtx, tushare);
    registerResearchTool(tushareCtx, tushare);
    registerEventsTool(tushareCtx, tushare);
  });
}

/** Register `ainfo_news`. */
function registerNewsTool(ctx, tushare) {
  ctx.systemPrompt.section({
    name: 'tool:ainfo_news',
    order: 151,
    text: 'Use ainfo_news for major market news over a time window. It returns headlines with source, timestamp and a short excerpt — quote them as published; do not present an excerpt as the full story.',
  });

  ctx.tools.register(defineTool({
    name: 'ainfo_news',
    description: 'Fetch major A-share market news for a time window (headline, source, timestamp, excerpt). ' + TOKEN_NOTE,
    parameters: {
      startTime: { type: 'string', required: true, description: 'Window start, "YYYY-MM-DD HH:MM:SS"' },
      endTime: { type: 'string', required: true, description: 'Window end, "YYYY-MM-DD HH:MM:SS"' },
      limit: { type: 'number', default: 100, description: 'Maximum headlines to return (max 1000)' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          count: { type: 'integer' },
          news: {
            type: 'array', required: true,
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                time: { type: 'string' }, title: { type: 'string' },
                source: { type: 'string' }, excerpt: { type: 'string' }, url: { type: 'string' },
              },
            },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: formatNewsOutput(value) }],
      presentationMeta: (_args, value) => ({ count: value.count }),
    },
    timeoutMs: 60000,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const rows = await tushare.query({
        apiName: 'major_news',
        params: { start_date: args.startTime, end_date: args.endTime },
        fields: 'title,content,pub_time,src',
        signal: exec.signal,
      });
      const limit = Math.max(1, Math.min(Math.floor(args.limit ?? 100), 1000));
      const news = rows.map(mapNews)
        .filter(item => item.title !== undefined)
        .sort((a, b) => String(b.time ?? '').localeCompare(String(a.time ?? '')))
        .slice(0, limit);
      return { count: news.length, news };
    },
    presentCall: (args) => ({ card: 'generic', title: `新闻 ${args.startTime} → ${args.endTime}`, kind: 'stock-news' }),
    presentResult: (_args, result) => (result.isError ? undefined : {
      card: 'generic', title: `新闻(${result.count} 条)`, kind: 'stock-news', count: result.count,
    }),
  }));
}

/** Model-facing summary; the items stay in the canonical value. */
function formatNewsOutput(value) {
  const news = value.news ?? [];
  if (news.length === 0) return '该时间窗口内没有新闻(注意 major_news 按发布时间过滤,需要 "YYYY-MM-DD HH:MM:SS")。';
  const lines = [`重要新闻 ${value.count} 条,最新在前:`];
  for (const item of news.slice(0, 8)) {
    lines.push(`  [${item.time ?? ''}] ${item.title}${item.source ? ' — ' + item.source : ''}`);
  }
  if (news.length > 8) lines.push(`  …(共 ${news.length} 条,全部在规范值 news[] 里,含摘要)`);
  return lines.join('\n');
}

/** Register `ainfo_research`. */
function registerResearchTool(ctx, tushare) {
  ctx.systemPrompt.section({
    name: 'tool:ainfo_research',
    order: 152,
    text: 'Use ainfo_research for broker research: ratings and target prices per stock, or the whole market for one report date. Ratings are the brokers\' opinions, not facts — attribute them.',
  });

  ctx.tools.register(defineTool({
    name: 'ainfo_research',
    description: 'Fetch A-share broker research ratings and target prices, for one stock or for a report date across the market. ' + TOKEN_NOTE,
    parameters: {
      code: { type: 'string', default: '', description: 'Stock code; empty needs reportDate instead' },
      reportDate: { type: 'string', default: '', description: 'Report date YYYYMMDD; required when no code is given' },
      limit: { type: 'number', default: 100, description: 'Maximum rows (max 2000)' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          count: { type: 'integer' },
          reports: {
            type: 'array', required: true,
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                code: { type: 'string' }, name: { type: 'string' }, date: { type: 'string' },
                org: { type: 'string' }, author: { type: 'string' }, rating: { type: 'string' },
                reportTitle: { type: 'string' }, reportType: { type: 'string' },
                targetPrice: { type: 'number' }, minTargetPrice: { type: 'number' },
                maxTargetPrice: { type: 'number' }, epsForecastY0: { type: 'number' },
              },
            },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: formatResearchOutput(value) }],
      presentationMeta: (_args, value) => ({ count: value.count }),
    },
    timeoutMs: 60000,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      if (!args.code && !args.reportDate) {
        throw new Error('ainfo_research needs either a `code` or a `reportDate`');
      }
      const params = {};
      if (args.code) params.ts_code = toTsCode(args.code);
      if (args.reportDate) params.report_date = args.reportDate;
      const rows = await tushare.query({
        apiName: 'report_rc', params,
        fields: 'ts_code,name,report_date,report_title,report_type,org_name,author_name,rating,quarter,target_price,min_price,max_price',
        signal: exec.signal,
      });
      const limit = Math.max(1, Math.min(Math.floor(args.limit ?? 100), 2000));
      const reports = rows.map(mapResearch)
        .sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? '')))
        .slice(0, limit);
      return { count: reports.length, reports };
    },
    presentCall: (args) => ({
      card: 'generic', title: `研报 ${args.code || args.reportDate}`, kind: 'stock-research', rawInput: args.code,
    }),
    presentResult: (_args, result) => (result.isError ? undefined : {
      card: 'generic', title: `研报(${result.count} 条)`, kind: 'stock-research', count: result.count,
    }),
  }));
}

/** Model-facing summary with the rating distribution, not every report. */
function formatResearchOutput(value) {
  const reports = value.reports ?? [];
  if (reports.length === 0) return '没有匹配的研报。';
  const byRating = {};
  for (const report of reports) {
    const rating = report.rating ?? '未评级';
    byRating[rating] = (byRating[rating] ?? 0) + 1;
  }
  const targets = reports.map(r => r.targetPrice).filter(price => price !== undefined);
  const lines = [`研报 ${value.count} 条。评级分布:`
    + Object.entries(byRating).map(([rating, n]) => `${rating}×${n}`).join(' ')];
  if (targets.length > 0) {
    const average = targets.reduce((sum, price) => sum + price, 0) / targets.length;
    lines.push(`目标价:${targets.length} 家给出,均值 ${average.toFixed(2)},区间 `
      + `${Math.min(...targets).toFixed(2)}–${Math.max(...targets).toFixed(2)}`);
  }
  lines.push('最近几条:');
  for (const report of reports.slice(0, 5)) {
    lines.push(`  [${report.date ?? ''}] ${report.org ?? ''} ${report.rating ?? ''} ${report.reportTitle ?? ''}`);
  }
  lines.push('评级与目标价是券商观点,引用时请注明机构,不要当作事实陈述。');
  return lines.join('\n');
}

/** Register `ainfo_events`. */
function registerEventsTool(ctx, tushare) {
  ctx.systemPrompt.section({
    name: 'tool:ainfo_events',
    order: 153,
    text: 'Use ainfo_events for company disclosures: earnings pre-announcements ("forecast"), dividends ("dividend"), insider buying and selling ("holdertrade"), lock-up expiries ("float") and the top-ten shareholder register ("holders").',
  });

  ctx.tools.register(defineTool({
    name: 'ainfo_events',
    description: 'Fetch A-share company disclosures: earnings pre-announcements, dividends, insider share transactions, lock-up expiries, or the top-ten shareholder register. ' + TOKEN_NOTE,
    parameters: {
      kind: {
        type: 'string', required: true,
        description: 'One of: "forecast", "dividend", "holdertrade", "float", "holders"',
      },
      code: { type: 'string', default: '', description: 'Stock code; required for "holders", optional elsewhere' },
      annDate: { type: 'string', default: '', description: 'Announcement date YYYYMMDD, to scan the whole market for one day' },
      period: { type: 'string', default: '', description: 'Reporting period YYYYMMDD, used by "holders" and "dividend"' },
      limit: { type: 'number', default: 100, description: 'Maximum rows (max 2000)' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          kind: { type: 'string' },
          count: { type: 'integer' },
          events: {
            type: 'array', required: true,
            items: { type: 'object', additionalProperties: true, properties: { code: { type: 'string' } } },
          },
        },
      },
      render: (args, value) => [{ type: 'text', text: formatEventsOutput(args, value) }],
      presentationMeta: (_args, value) => ({ kind: value.kind, count: value.count }),
    },
    timeoutMs: 60000,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const spec = EVENT_KINDS[args.kind];
      if (!spec) throw new Error(`Unknown kind "${args.kind}". Use one of: ${Object.keys(EVENT_KINDS).join(', ')}`);
      if (!args.code && !args.annDate && args.kind !== 'forecast') {
        throw new Error(`kind "${args.kind}" needs a \`code\` (or an \`annDate\` to scan one day)`);
      }
      const params = {};
      if (args.code) params.ts_code = toTsCode(args.code);
      if (args.annDate) params.ann_date = args.annDate;
      if (args.period) params.period = args.period;
      const rows = await tushare.query({
        apiName: spec.apiName, params, fields: spec.fields, signal: exec.signal,
      });
      const limit = Math.max(1, Math.min(Math.floor(args.limit ?? 100), 2000));
      const events = rows.map(spec.map).slice(0, limit);
      return { kind: args.kind, count: events.length, events };
    },
    presentCall: (args) => ({
      card: 'generic', title: `${EVENT_KINDS[args.kind]?.label ?? '事件'} ${args.code || args.annDate || ''}`,
      kind: 'stock-events', rawInput: args.code,
    }),
    presentResult: (_args, result) => (result.isError ? undefined : {
      card: 'generic', title: `${EVENT_KINDS[result.kind]?.label ?? '事件'}(${result.count} 条)`,
      kind: 'stock-events', count: result.count,
    }),
  }));
}

/** Model-facing summary; the rows stay in the canonical value. */
function formatEventsOutput(args, value) {
  const events = value.events ?? [];
  const label = EVENT_KINDS[value.kind]?.label ?? value.kind;
  if (events.length === 0) return `${label}:没有匹配的记录。`;
  const lines = [`${label}:${value.count} 条。`];
  for (const event of events.slice(0, 6)) {
    const when = event.annDate ?? event.floatDate ?? event.period ?? '';
    const who = event.holder ?? event.code ?? '';
    const what = event.type ?? event.direction ?? event.status ?? '';
    const size = event.changeRatio ?? event.floatRatio ?? event.holdRatio ?? event.cashDividend;
    lines.push(`  [${when}] ${who} ${what} ${size === undefined ? '' : size}`.trimEnd());
  }
  if (events.length > 6) lines.push(`  …(共 ${events.length} 条,全部在规范值 events[] 里)`);
  return lines.join('\n');
}

export { apply, name, inject, EVENT_KINDS, TOKEN_NOTE };
