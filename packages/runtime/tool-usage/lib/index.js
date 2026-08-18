/**
 * DSH Plugin: tool usage and cost observation.
 *
 * Wraps tool dispatch to measure what a session actually spends — how many
 * calls, how long each tool takes, how often it fails — and exposes the
 * tally as the `toolUsage` service. Heavy work (whole-market pulls, wide
 * date windows) is invisible until something times out; this makes the cost
 * legible while the session is still running.
 *
 * Registers no tools. It wraps `tools/execute`, the documented seam for
 * timeouts, retries and metrics, and it changes nothing about the call: it
 * forwards `next()` and returns that result untouched.
 *
 * @module dsh-plugin-tool-usage
 */

import Schema from '@deepseek-ai/schemastery';
import { fold, summarize, renderSummary, renderBudgetWarning } from './stats.js';

/** Cordis plugin name used by loader diagnostics. */
const name = 'tool-usage';

/** Services required before `apply` runs. */
const inject = ['systemPrompt'];

const Config = Schema.object({
  budgetCalls: Schema.number().default(0).description(
    '一次会话的工具调用次数预算,超过后在提示词里提醒模型收敛用法。0 表示不提醒。',
  ),
  budgetSeconds: Schema.number().default(0).description(
    '一次会话花在工具上的秒数预算,超过后同样提醒。0 表示不提醒。',
  ),
  sampleLimit: Schema.number().default(200).description(
    '每个工具保留多少条最近耗时用于算分位数。分位数要反映工具「现在」的表现,'
    + '保留全部历史只会让一小时前的冷启动一直拖累它。',
  ),
  topN: Schema.number().default(10).description(
    '摘要里最多列出几个工具(按累计耗时排序)。',
  ),
  logOnDispose: Schema.boolean().default(true).description(
    '插件卸载(会话结束/重启服务)时把用量摘要写进日志,便于事后翻账。',
  ),
});

/**
 * Measure every dispatched tool call.
 * @param {Object} ctx - Plugin context
 * @param {Object} config - Validated config
 */
function apply(ctx, config = {}) {
  const sampleLimit = Math.max(1, Math.floor(config.sampleLimit ?? 200));
  const topN = Math.max(1, Math.floor(config.topN ?? 10));
  const budget = {
    calls: Math.max(0, Math.floor(config.budgetCalls ?? 0)),
    seconds: Math.max(0, config.budgetSeconds ?? 0),
  };

  /** @type {Map<string, Object>} toolName → statistics */
  const stats = new Map();

  ctx.on('tools/execute', async (exec, next) => {
    const startedAt = Date.now();
    let ok = false;
    try {
      const result = await next();
      ok = !result?.isError;
      return result;
    } finally {
      // Recorded in `finally` so a thrown dispatch still counts: a call that
      // blew up spent its time too, and hiding it would make the slowest tool
      // in a bad session look like the cheapest.
      const toolName = typeof exec?.name === 'string' && exec.name !== '' ? exec.name : '(unknown)';
      // `exec.parent` is set only on run_code sub-dispatches. Marking them is
      // what keeps the session total a wall clock: the parent's duration
      // already contains theirs.
      stats.set(toolName, fold(
        stats.get(toolName),
        { ms: Date.now() - startedAt, ok, nested: exec?.parent !== undefined },
        sampleLimit,
      ));
    }
  });

  // Evaluated at each assembly, and empty while the session stays within
  // budget — an ordinary session pays nothing for this plugin.
  ctx.systemPrompt.context({
    name: 'tool-usage:budget',
    order: 61,
    text: () => renderBudgetWarning(stats, budget),
  });

  // A service rather than a model-facing tool: the tally is for the operator
  // and for other plugins (a UI panel is the natural consumer), and adding a
  // tool would spend prompt budget on every request to describe a report
  // nobody asked for.
  ctx.provide('toolUsage', {
    /** Machine-readable totals plus the per-tool table, heaviest first. */
    snapshot: () => summarize(stats),
    /** The same tally as one human-readable block. */
    report: (options = {}) => renderSummary(stats, { topN, ...options }),
    /** Forget everything measured so far. */
    reset: () => stats.clear(),
  });

  if (config.logOnDispose ?? true) {
    ctx.effect(() => () => {
      if (stats.size === 0) return;
      const line = renderSummary(stats, { topN });
      // Logging must never take the shell down on the way out.
      try {
        (ctx.logger?.info ?? console.info).call(ctx.logger ?? console, line);
      } catch { /* ignore */ }
    }, 'tool-usage: summary on dispose');
  }
}

export { apply, name, inject, Config };
