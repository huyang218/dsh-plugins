/**
 * DSH Plugin: A-share watchlist and holdings.
 *
 * The one stateful plugin here. Everything else in this repo answers from the
 * market; this remembers what the user owns and watches, so "how am I doing"
 * is a question the agent can answer without being told the positions again in
 * every session.
 *
 * State lives in the storage domain, not in a chat transcript, because a
 * position the agent has to re-read from history is a position it will
 * eventually get wrong.
 *
 * @module dsh-plugin-aportfolio
 */

import Schema from '@deepseek-ai/schemastery';
import { z } from 'zod';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain';
import { fetchQuotes, normalizeCode } from './quotes.js';
import { valuePosition, summarize, targetHit, money } from './valuation.js';

/** Cordis plugin name used by loader diagnostics. */
const name = 'aportfolio';

/** Services required before `apply` runs. */
const inject = ['tools', 'systemPrompt'];

/** Persisted shape; a stored unit stamped with another version is rejected. */
const PORTFOLIO_DOMAIN = defineDomain({
  name: 'portfolio',
  version: 1,
  tables: {
    positions: domainTable(z.object({
      code: z.string(),
      shares: z.number(),
      cost: z.number().optional(),
      note: z.string().optional(),
      updatedAt: z.number().optional(),
    })),
    watchlist: domainTable(z.object({
      code: z.string(),
      note: z.string().optional(),
      targetBuy: z.number().optional(),
      targetSell: z.number().optional(),
      updatedAt: z.number().optional(),
    })),
  },
});

const Config = Schema.object({
  maxEntries: Schema.number().default(200).description(
    '自选与持仓各自的条目上限。超过后新增会被拒绝,而不是悄悄挤掉旧的——'
    + '持仓记录被静默丢弃比拒绝新增严重得多。',
  ),
  quoteConcurrency: Schema.number().default(6).description(
    '取行情时的并发数。组合通常几十只,并发过高只会招来数据源限流。',
  ),
});

/**
 * Register the portfolio tools once storage is available.
 * @param {Object} ctx - Plugin context
 * @param {Object} config - Validated config
 */
function apply(ctx, config = {}) {
  // Registered unconditionally: without storage the tools below do not exist,
  // and the model needs to be able to explain that rather than act as if the
  // capability were never installed.
  ctx.systemPrompt.section({
    name: 'aportfolio:state',
    order: 155,
    text: [
      'aportfolio remembers the user\'s A-share holdings and watchlist across sessions',
      '(aportfolio_view reads them with live prices; aportfolio_edit changes them).',
      'Positions and targets are the user\'s own records: never invent, guess or "restore"',
      'an entry that is not there — ask. If these tools are missing, this deployment has no',
      'storage backend composed and the plugin cannot keep state; say so.',
    ].join('\n'),
  });

  ctx.inject(['storageDomain'], (storageCtx) => {
    let domain;
    const opening = storageCtx.storageDomain.open(PORTFOLIO_DOMAIN)
      .then(opened => { domain = opened; })
      .catch(() => { /* surfaced per call below */ });

    storageCtx.effect(() => () => {
      opening.then(() => domain?.close()).catch(() => {});
    }, 'aportfolio: portfolio domain');

    /** The open domain, or a clear failure rather than a silent empty book. */
    const useDomain = async () => {
      await opening;
      if (!domain) throw new Error('组合数据打不开(存储后端不可用)。请如实告诉用户,不要凭对话历史重建持仓。');
      return domain;
    };

    registerViewTool(storageCtx, config, useDomain);
    registerEditTool(storageCtx, config, useDomain);
  });
}

/** Read one table as plain entries. */
async function readTable(useDomain, table) {
  const domain = await useDomain();
  return [...domain.table(table).entries()].map(([, value]) => ({ ...value }));
}

/**
 * Register `aportfolio_view`.
 * @param {Object} ctx - Plugin context with storage
 * @param {Object} config - Validated config
 * @param {Function} useDomain - Resolves the open domain
 */
function registerViewTool(ctx, config, useDomain) {
  ctx.systemPrompt.section({
    name: 'tool:aportfolio_view',
    order: 156,
    text: 'Use aportfolio_view to answer "how are my holdings doing" or "what am I watching". It prices every stored entry live and returns per-position profit, weights and portfolio totals, plus watchlist entries that reached a price target.',
  });

  ctx.tools.register(defineTool({
    name: 'aportfolio_view',
    description: 'Read the user\'s stored A-share holdings and watchlist, priced live: per-position profit and weight, portfolio totals, and watchlist entries that hit a buy or sell target.',
    parameters: {
      scope: {
        type: 'string', default: 'all',
        description: '"all", "positions" (holdings only) or "watchlist" (watched stocks only)',
      },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          scope: { type: 'string' },
          marketValue: { type: 'number', description: 'Total market value in 元' },
          costValue: { type: 'number' },
          profit: { type: 'number' },
          profitPct: { type: 'number' },
          unpriced: { type: 'integer', description: 'Holdings whose price could not be fetched' },
          positions: {
            type: 'array', required: true,
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                code: { type: 'string' }, name: { type: 'string' }, shares: { type: 'number' },
                cost: { type: 'number' }, price: { type: 'number' }, changePct: { type: 'number' },
                marketValue: { type: 'number' }, costValue: { type: 'number' },
                profit: { type: 'number' }, profitPct: { type: 'number' },
                weightPct: { type: 'number' }, note: { type: 'string' },
              },
            },
          },
          watchlist: {
            type: 'array', required: true,
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                code: { type: 'string' }, name: { type: 'string' }, price: { type: 'number' },
                changePct: { type: 'number' }, targetBuy: { type: 'number' },
                targetSell: { type: 'number' }, hit: { type: 'string' }, note: { type: 'string' },
              },
            },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: formatView(value) }],
      presentationMeta: (_args, value) => ({
        scope: value.scope,
        positions: value.positions.length,
        watching: value.watchlist.length,
        profitPct: value.profitPct,
      }),
    },
    timeoutMs: 60000,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const scope = args.scope ?? 'all';
      const wantPositions = scope === 'all' || scope === 'positions';
      const wantWatch = scope === 'all' || scope === 'watchlist';
      const held = wantPositions ? await readTable(useDomain, 'positions') : [];
      const watched = wantWatch ? await readTable(useDomain, 'watchlist') : [];

      const quotes = await fetchQuotes(
        [...held.map(e => e.code), ...watched.map(e => e.code)],
        { signal: exec.signal, concurrency: config.quoteConcurrency ?? 6 },
      );

      const summary = summarize(held.map(entry => valuePosition(entry, quotes.get(entry.code))));
      const watchlist = watched.map(entry => {
        const quote = quotes.get(entry.code);
        const row = { code: entry.code };
        if (quote?.name) row.name = quote.name;
        if (quote?.price !== undefined) row.price = quote.price;
        if (quote?.changePct !== undefined) row.changePct = quote.changePct;
        if (entry.targetBuy !== undefined) row.targetBuy = entry.targetBuy;
        if (entry.targetSell !== undefined) row.targetSell = entry.targetSell;
        if (entry.note) row.note = entry.note;
        const hit = targetHit(entry, quote);
        if (hit) row.hit = hit;
        return row;
      }).sort((a, b) => a.code.localeCompare(b.code));

      const value = {
        scope,
        positions: summary.rows.sort((a, b) => (b.marketValue ?? 0) - (a.marketValue ?? 0)),
        watchlist,
        unpriced: summary.unpriced,
        marketValue: summary.marketValue,
      };
      for (const key of ['costValue', 'profit', 'profitPct']) {
        if (summary[key] !== undefined) value[key] = summary[key];
      }
      return value;
    },
    presentCall: (args) => ({ card: 'generic', title: `组合 ${args.scope ?? 'all'}`, kind: 'portfolio' }),
    presentResult: (_args, result) => (result.isError ? undefined : {
      card: 'generic',
      title: `组合(${result.positions?.length ?? 0} 持仓 / ${result.watchlist?.length ?? 0} 自选)`,
      kind: 'portfolio',
    }),
  }));
}

/** Model-facing text: a portfolio is small, so the rows themselves belong here. */
function formatView(value) {
  const lines = [];
  if (value.positions.length > 0) {
    lines.push(`持仓 ${value.positions.length} 只,市值 ${money(value.marketValue)}`
      + (value.profit === undefined ? ''
        : `,盈亏 ${value.profit >= 0 ? '+' : ''}${money(value.profit)}(${value.profitPct.toFixed(2)}%)`));
    for (const row of value.positions) {
      lines.push(`  ${row.code} ${row.name ?? ''} ${row.shares}股`
        + (row.price === undefined ? '  ⚠ 取价失败' : `  现价 ${row.price.toFixed(2)}`)
        + (row.profitPct === undefined ? '' : `  盈亏 ${row.profitPct >= 0 ? '+' : ''}${row.profitPct.toFixed(2)}%`)
        + (row.weightPct === undefined ? '' : `  占比 ${row.weightPct.toFixed(1)}%`));
    }
    if (value.unpriced > 0) {
      lines.push(`  ⚠ ${value.unpriced} 只取价失败,已排除在总额之外——总市值因此偏低,不要当作完整数字。`);
    }
  } else if (value.scope !== 'watchlist') {
    lines.push('还没有记录任何持仓。');
  }

  if (value.watchlist.length > 0) {
    lines.push('', `自选 ${value.watchlist.length} 只:`);
    for (const row of value.watchlist) {
      lines.push(`  ${row.code} ${row.name ?? ''}`
        + (row.price === undefined ? '  ⚠ 取价失败' : `  现价 ${row.price.toFixed(2)}`)
        + (row.hit === 'buy' ? `  ★ 已触及买入目标 ${row.targetBuy}` : '')
        + (row.hit === 'sell' ? `  ★ 已触及卖出目标 ${row.targetSell}` : ''));
    }
  } else if (value.scope !== 'positions') {
    lines.push('自选列表是空的。');
  }
  return lines.join('\n');
}

/**
 * Register `aportfolio_edit`.
 * @param {Object} ctx - Plugin context with storage
 * @param {Object} config - Validated config
 * @param {Function} useDomain - Resolves the open domain
 */
function registerEditTool(ctx, config, useDomain) {
  ctx.systemPrompt.section({
    name: 'tool:aportfolio_edit',
    order: 157,
    text: 'Use aportfolio_edit to record what the user tells you they own or want to watch — never to guess. Setting a position replaces that stock\'s entry outright, so include the full share count and cost, not a delta.',
  });

  ctx.tools.register(defineTool({
    name: 'aportfolio_edit',
    description: 'Record or remove one holding or watchlist entry. Only ever store what the user stated: a "set" replaces that stock\'s entry, so pass the complete share count and cost rather than a change.',
    parameters: {
      action: { type: 'string', required: true, description: '"set" or "remove"' },
      kind: { type: 'string', required: true, description: '"position" (owned) or "watch" (watchlist)' },
      code: { type: 'string', required: true, description: 'Stock code, e.g. "600519"' },
      shares: { type: 'number', default: 0, description: 'Share count, for a position' },
      cost: { type: 'number', default: 0, description: 'Average cost per share, for a position' },
      targetBuy: { type: 'number', default: 0, description: 'Buy target price, for a watchlist entry' },
      targetSell: { type: 'number', default: 0, description: 'Sell target price, for a watchlist entry' },
      note: { type: 'string', default: '', description: 'Free-form note kept with the entry' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          action: { type: 'string' },
          kind: { type: 'string' },
          code: { type: 'string' },
          stored: { type: 'boolean', description: 'Whether the entry now exists' },
          entries: { type: 'integer', description: 'Entries in that table afterwards' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.action === 'remove'
          ? (value.stored
            ? `已删除${value.kind === 'position' ? '持仓' : '自选'} ${value.code}(现有 ${value.entries} 条)。`
            : `${value.code} 本来就不在${value.kind === 'position' ? '持仓' : '自选'}里,未做改动。`)
          : `已记录${value.kind === 'position' ? '持仓' : '自选'} ${value.code}(现有 ${value.entries} 条)。`,
      }],
      presentationMeta: (_args, value) => ({ action: value.action, code: value.code, kind: value.kind }),
    },
    timeoutMs: 15000,
    isConcurrencySafe: () => false,
    async execute(args) {
      const domain = await useDomain();
      const table = args.kind === 'position' ? 'positions' : args.kind === 'watch' ? 'watchlist' : undefined;
      if (!table) throw new Error(`Unknown kind "${args.kind}". Use "position" or "watch".`);
      const code = normalizeCode(args.code);
      if (!/^\d{6}$/.test(code)) throw new Error(`"${args.code}" is not a six-digit A-share code`);
      const kv = domain.table(table);

      if (args.action === 'remove') {
        const stored = await kv.delete(code);
        return { action: 'remove', kind: args.kind, code, stored, entries: kv.size };
      }
      if (args.action !== 'set') throw new Error(`Unknown action "${args.action}". Use "set" or "remove".`);

      const limit = Math.max(1, Math.floor(config.maxEntries ?? 200));
      if (kv.get(code) === undefined && kv.size >= limit) {
        // Refusing beats evicting: a silently dropped holding is a wrong
        // portfolio the user has no way to notice.
        throw new Error(`${table} 已达上限 ${limit} 条。请先删除不再需要的条目,或调大 maxEntries 配置。`);
      }

      const entry = { code, updatedAt: Date.now() };
      if (table === 'positions') {
        if (!(args.shares > 0)) throw new Error('记录持仓需要正的 shares(股数)。');
        entry.shares = args.shares;
        if (args.cost > 0) entry.cost = args.cost;
      } else {
        if (args.targetBuy > 0) entry.targetBuy = args.targetBuy;
        if (args.targetSell > 0) entry.targetSell = args.targetSell;
      }
      if (args.note) entry.note = args.note;
      await kv.put(code, entry);
      return { action: 'set', kind: args.kind, code, stored: true, entries: kv.size };
    },
    presentCall: (args) => ({
      card: 'generic', title: `${args.action === 'remove' ? '删除' : '记录'} ${args.code}`,
      kind: 'portfolio', rawInput: args.code,
    }),
    presentResult: (_args, result) => (result.isError ? undefined : {
      card: 'generic', title: `${result.code} 已${result.action === 'remove' ? '删除' : '记录'}`, kind: 'portfolio',
    }),
  }));
}

export { apply, name, inject, Config, PORTFOLIO_DOMAIN, formatView };
