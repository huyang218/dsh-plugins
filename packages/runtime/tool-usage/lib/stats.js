/**
 * Usage accounting: pure aggregation over tool calls, with no clock and no I/O
 * of its own so every rule is testable by passing numbers in.
 *
 * @module dsh-plugin-tool-usage/stats
 */

/** A tool with no calls yet. */
function emptyStat() {
  return { calls: 0, failures: 0, totalMs: 0, maxMs: 0, samples: [] };
}

/**
 * Fold one finished call into a tool's statistics.
 *
 * Recent durations are kept in a bounded ring rather than a growing array: a
 * long session would otherwise hold every duration it ever measured, and the
 * percentiles that matter describe how the tool behaves NOW, not an average
 * dragged down by a cold start an hour ago.
 * @param {Object} stat - Existing statistics, or undefined
 * @param {Object} call - `{ ms, ok }`
 * @param {number} [sampleLimit=200] - Durations retained per tool
 * @returns {Object} The updated statistics
 */
function fold(stat, { ms, ok }, sampleLimit = 200) {
  const next = { ...emptyStat(), ...stat, samples: [...(stat?.samples ?? [])] };
  const duration = Number.isFinite(ms) && ms >= 0 ? ms : 0;
  next.calls += 1;
  if (!ok) next.failures += 1;
  next.totalMs += duration;
  next.maxMs = Math.max(next.maxMs, duration);
  next.samples.push(duration);
  if (next.samples.length > sampleLimit) next.samples.splice(0, next.samples.length - sampleLimit);
  return next;
}

/**
 * Nearest-rank percentile over the retained samples.
 * @param {number[]} samples - Durations
 * @param {number} fraction - 0..1
 * @returns {number|undefined} The percentile, or undefined with no samples
 */
function percentile(samples, fraction) {
  if (!samples || samples.length === 0) return undefined;
  const sorted = [...samples].sort((a, b) => a - b);
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1));
  return sorted[rank];
}

/**
 * Session totals plus a per-tool table, heaviest first.
 *
 * Sorted by TOTAL time rather than call count or mean: the tool worth looking
 * at is the one the session actually spent its wall clock in, which a tool
 * called once for twelve seconds is and a tool called forty times for a
 * millisecond is not.
 * @param {Map<string, Object>} stats - toolName → statistics
 * @returns {Object} `{ calls, failures, totalMs, tools: [...] }`
 */
function summarize(stats) {
  const tools = [...stats.entries()].map(([name, stat]) => ({
    name,
    calls: stat.calls,
    failures: stat.failures,
    totalMs: Math.round(stat.totalMs),
    meanMs: stat.calls > 0 ? Math.round(stat.totalMs / stat.calls) : 0,
    p95Ms: Math.round(percentile(stat.samples, 0.95) ?? 0),
    maxMs: Math.round(stat.maxMs),
  })).sort((a, b) => b.totalMs - a.totalMs);

  return {
    calls: tools.reduce((sum, tool) => sum + tool.calls, 0),
    failures: tools.reduce((sum, tool) => sum + tool.failures, 0),
    totalMs: tools.reduce((sum, tool) => sum + tool.totalMs, 0),
    tools,
  };
}

/** Milliseconds as a short human string. */
function duration(ms) {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  return `${minutes}m${Math.round((ms % 60_000) / 1000)}s`;
}

/** One human-readable table of the session's tool spending. */
function renderSummary(stats, { topN = 10 } = {}) {
  const summary = summarize(stats);
  if (summary.calls === 0) return 'No tool calls yet.';
  const lines = [
    `Tool usage: ${summary.calls} calls, ${summary.failures} failed, `
    + `${duration(summary.totalMs)} spent in tools.`,
  ];
  for (const tool of summary.tools.slice(0, topN)) {
    lines.push(`  ${tool.name}: ${tool.calls}×  total ${duration(tool.totalMs)}  `
      + `mean ${duration(tool.meanMs)}  p95 ${duration(tool.p95Ms)}`
      + (tool.failures > 0 ? `  (${tool.failures} failed)` : ''));
  }
  if (summary.tools.length > topN) lines.push(`  …and ${summary.tools.length - topN} more tools`);
  return lines.join('\n');
}

/**
 * The prompt warning shown once a session is spending heavily.
 *
 * Returns '' below the budget, so an ordinary session pays nothing for this
 * plugin. Over budget, the message is deliberately about TECHNIQUE — batch
 * over per-item calls, narrower windows — because "you are being slow" that
 * suggests nothing just makes the model apologise and continue.
 * @param {Map<string, Object>} stats - toolName → statistics
 * @param {Object} budget - `{ calls, seconds }`; 0 disables that half
 * @returns {string} Prompt text, or '' while within budget
 */
function renderBudgetWarning(stats, { calls: callBudget = 0, seconds: secondBudget = 0 } = {}) {
  const summary = summarize(stats);
  const overCalls = callBudget > 0 && summary.calls >= callBudget;
  const overTime = secondBudget > 0 && summary.totalMs >= secondBudget * 1000;
  if (!overCalls && !overTime) return '';

  const heaviest = summary.tools[0];
  const lines = [
    `This session has already made ${summary.calls} tool calls totalling `
    + `${duration(summary.totalMs)} of tool time.`,
  ];
  if (heaviest) {
    lines.push(`Most of it is ${heaviest.name} (${heaviest.calls} calls, ${duration(heaviest.totalMs)}).`);
  }
  lines.push(
    'Prefer one batch call over many per-item calls, narrow date ranges and result sets to',
    'what the question needs, and reuse data you already fetched instead of fetching it again.',
  );
  return lines.join('\n');
}

export { emptyStat, fold, percentile, summarize, duration, renderSummary, renderBudgetWarning };
