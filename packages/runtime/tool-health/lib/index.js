/**
 * DSH Plugin: tool health memory.
 *
 * Observes every tool result and remembers, ACROSS SESSIONS, which tools have
 * been failing and with what error. The next session's prompt carries that
 * summary, so an agent does not rediscover a dead endpoint the hard way — one
 * failed call at a time, in the middle of a task.
 *
 * Registers no tools and rewrites nothing: it listens on `tools/result`, which
 * is an emit-mode observation point, so it cannot change what a tool returns.
 *
 * @module dsh-plugin-tool-health
 */

import Schema from '@deepseek-ai/schemastery';
import { z } from 'zod';
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain';
import { fold, isUnhealthy, renderReport } from './health.js';

/** Cordis plugin name used by loader diagnostics. */
const name = 'tool-health';

/** Services required before `apply` runs. */
const inject = ['systemPrompt'];

/**
 * The persisted shape. `version` is stamped on the medium: a stored unit whose
 * version differs is rejected rather than silently reinterpreted, so changing
 * these fields means bumping it.
 */
const HEALTH_DOMAIN = defineDomain({
  name: 'tool_health',
  version: 1,
  tables: {
    tools: domainTable(z.object({
      calls: z.number(),
      failures: z.number(),
      streak: z.number(),
      lastOkAt: z.number().optional(),
      lastFailAt: z.number().optional(),
      lastError: z.string().optional(),
    })),
  },
});

const Config = Schema.object({
  unhealthyAfter: Schema.number().default(2).description(
    '连续失败多少次才算「坏了」。1 会让偶发抖动也进提示词,过大则等到用户已经受影响才提醒。',
  ),
  forgetAfterHours: Schema.number().default(24).description(
    '多久之前的失败不再提。上周的故障说明不了今天的事,继续提醒只会教模型躲开其实可用的工具。',
  ),
  maxTools: Schema.number().default(200).description(
    '最多记住多少个工具,超出后淘汰最久未更新的,避免存储无限增长。',
  ),
  maxListed: Schema.number().default(8).description(
    '一次最多在提示词里列出几个坏掉的工具。',
  ),
});

/**
 * Observe tool results, remember failures, and report them next time.
 * @param {Object} ctx - Plugin context
 * @param {Object} config - Validated config
 */
function apply(ctx, config = {}) {
  const unhealthyAfter = Math.max(1, Math.floor(config.unhealthyAfter ?? 2));
  const staleMs = Math.max(1, config.forgetAfterHours ?? 24) * 3_600_000;
  const maxTools = Math.max(1, Math.floor(config.maxTools ?? 200));
  const maxListed = Math.max(1, Math.floor(config.maxListed ?? 8));

  /** Authoritative in-memory state; storage is the durable mirror. @type {Map<string, Object>} */
  const records = new Map();
  let persist = null;

  ctx.on('tools/result', (exec, result) => {
    const toolName = exec?.name;
    if (typeof toolName !== 'string' || toolName === '') return;
    const record = fold(records.get(toolName), {
      ok: !result?.isError,
      at: Date.now(),
      error: result?.isError ? failureText(result) : undefined,
    });
    records.set(toolName, record);
    evict(records, maxTools);
    // Writing is fire-and-forget on purpose: health bookkeeping must never
    // delay or fail a tool call it is only watching.
    persist?.(toolName, record);
  });

  // Dynamic text, evaluated at each assembly — the report has to reflect what
  // has failed SO FAR in this session, not what had failed when the plugin
  // loaded.
  ctx.systemPrompt.context({
    name: 'tool-health:recent-failures',
    order: 60,
    text: () => renderReport(records, { now: Date.now(), unhealthyAfter, staleMs, maxListed }),
  });

  // Persistence is optional: without a storage backend the plugin still works
  // within one session, which is better than refusing to load.
  ctx.inject(['storageDomain'], (storageCtx) => {
    storageCtx.effect(() => {
      let domain;
      let closed = false;
      const opening = storageCtx.storageDomain.open(HEALTH_DOMAIN).then(opened => {
        if (closed) return void opened.close();
        domain = opened;
        for (const [toolName, stored] of opened.table('tools').entries()) {
          // A record already in memory is newer than the stored one.
          if (!records.has(toolName)) records.set(toolName, { ...stored });
        }
        persist = (toolName, record) => {
          domain?.table('tools').put(toolName, record).catch(() => {});
        };
      }).catch(() => { /* storage trouble must not take the observer down */ });

      return async () => {
        closed = true;
        persist = null;
        await opening;
        await domain?.close();
      };
    }, 'tool-health: durable records');
  });
}

/**
 * A short, stable description of why a call failed.
 * @param {Object} result - The failed ToolExecutionResult
 * @returns {string} One line naming the failure
 */
function failureText(result) {
  const error = result?.error;
  const code = typeof error?.code === 'string' ? error.code : undefined;
  const message = typeof error?.message === 'string' ? error.message : undefined;
  if (code && message) return `${code}: ${message}`;
  if (code || message) return code ?? message;
  const text = result?.content?.find(block => block?.type === 'text')?.text;
  return typeof text === 'string' && text !== '' ? text : 'unknown error';
}

/**
 * Keep the store bounded, dropping the least recently touched tools first.
 * @param {Map<string, Object>} records - The store
 * @param {number} maxTools - Upper bound
 */
function evict(records, maxTools) {
  if (records.size <= maxTools) return;
  const touched = record => Math.max(record.lastOkAt ?? 0, record.lastFailAt ?? 0);
  const ordered = [...records.entries()].sort((a, b) => touched(a[1]) - touched(b[1]));
  for (const [toolName] of ordered.slice(0, records.size - maxTools)) records.delete(toolName);
}

export { apply, name, inject, Config, HEALTH_DOMAIN, failureText, evict };
