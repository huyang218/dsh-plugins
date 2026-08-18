/**
 * DSH Plugin: retry transient tool failures.
 *
 * dsh retries the model request (`dsh-llm-retry`) and enforces tool deadlines
 * (`dsh-tool-call-timeout-policy`), but nothing retries a tool call. So a
 * socket closed by a data source mid-scan ends the task, and the agent —
 * having been told only that the data is unavailable — is left to improvise.
 *
 * Retrying is dangerous in exactly one way: a tool that wrote, ordered or sent
 * something would do it twice. Nothing in the tool contract says which tools
 * are safe to repeat (`isConcurrencySafe` is about overlap, not idempotence),
 * so this plugin retries NOTHING until an operator names the tools. Read-only
 * data tools are the intended list.
 *
 * @module dsh-plugin-tool-retry
 */

import Schema from '@deepseek-ai/schemastery';
import { decide, backoffFor, exhaustedNote } from './policy.js';

/** Cordis plugin name used by loader diagnostics. */
const name = 'tool-retry';

/** Services required before `apply` runs. */
const inject = ['tools'];

const Config = Schema.object({
  retryTools: Schema.array(Schema.string()).default([]).description(
    '允许重试的工具名,支持结尾 `*` 前缀匹配(如 `astock_*`)。**默认空:什么都不重试**——'
    + '工具契约里没有「幂等」这一项,写入类工具重试一次就会做两遍。只填只读取数的工具。',
  ),
  maxAttempts: Schema.number().default(3).description(
    '每次调用最多尝试几次(含第一次)。',
  ),
  backoffMs: Schema.number().default(500).description(
    '首次重试前的等待,之后指数增长。值得重试的失败多半是对端在过载,'
    + '紧凑循环只会把别人的短暂拥塞变成自己的故障。',
  ),
  maxBackoffMs: Schema.number().default(8000).description('退避上限。'),
  retryDeadlineMs: Schema.number().default(120000).description(
    '给每次重试尝试单独加的截止时间。重试会**跳过已被消费的下游包装器**'
    + '(包括官方的超时策略),所以这层截止时间必须由本插件自己补上,否则一次卡死的重试没有人叫停。',
  ),
});

/**
 * Wrap tool dispatch with retries for the declared tools.
 * @param {Object} ctx - Plugin context
 * @param {Object} config - Validated config
 */
function apply(ctx, config = {}) {
  const settings = {
    retryTools: config.retryTools ?? [],
    maxAttempts: Math.max(1, Math.floor(config.maxAttempts ?? 3)),
    backoffMs: Math.max(0, config.backoffMs ?? 500),
    maxBackoffMs: Math.max(0, config.maxBackoffMs ?? 8000),
    retryDeadlineMs: Math.max(0, config.retryDeadlineMs ?? 120000),
  };

  ctx.on('tools/execute', async (exec, next) => {
    const toolName = typeof exec?.name === 'string' ? exec.name : '';
    let attempt = 1;
    for (;;) {
      const outcome = await attemptOnce(next, attempt > 1 ? exec : undefined, settings);
      const verdict = decide({ toolName, outcome, attempt, config: settings });

      if (!verdict.retry) {
        if (attempt > 1 && verdict.failure !== undefined) {
          return annotate(outcome, exhaustedNote(attempt, toolName));
        }
        if (outcome.error) throw outcome.error;
        return outcome.result;
      }

      const wait = backoffFor(attempt, settings);
      try {
        await sleep(wait, exec?.signal);
      } catch {
        // The caller cancelled while we waited: return the failure we already
        // have rather than starting an attempt nobody is waiting for.
        if (outcome.error) throw outcome.error;
        return outcome.result;
      }
      attempt += 1;
    }
  });
}

/**
 * Run one dispatch, optionally under an added deadline.
 *
 * The deadline matters only from the second attempt on: cordis's waterfall
 * consumes its listener list, so a repeated `next()` reaches the tool body
 * directly and skips every wrapper already shifted off — the official timeout
 * policy included. Without this the retry would be the one attempt nobody can
 * stop.
 * @param {Function} next - The dispatch continuation
 * @param {Object} [exec] - Mutable execution to fit with a deadline, when retrying
 * @param {Object} settings - Resolved config
 * @returns {Promise<{result?: Object, error?: Error}>} The settled outcome
 */
async function attemptOnce(next, exec, settings) {
  if (!exec || settings.retryDeadlineMs <= 0) {
    try {
      return { result: await next() };
    } catch (error) {
      return { error };
    }
  }

  const original = exec.signal;
  const timeout = AbortSignal.timeout(settings.retryDeadlineMs);
  // Fused, never replaced: the caller's cancellation must survive the swap.
  exec.signal = original ? AbortSignal.any([original, timeout]) : timeout;
  try {
    return { result: await next() };
  } catch (error) {
    return { error };
  } finally {
    exec.signal = original;
  }
}

/** Append a line to a failed result's text without changing anything else. */
function annotate(outcome, note) {
  if (outcome.error) {
    outcome.error.message = `${outcome.error.message}\n${note}`;
    throw outcome.error;
  }
  const result = outcome.result;
  if (!result?.isError) return result;
  const content = (result.content ?? []).map(block => (block?.type === 'text'
    ? { ...block, text: `${block.text}\n${note}` }
    : block));
  return content.length === (result.content ?? []).length && content.some(b => b?.type === 'text')
    ? { ...result, content }
    : { ...result, content: [...content, { type: 'text', text: note }] };
}

/** Sleep that gives up when the caller cancels. */
function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason ?? new Error('aborted'));
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(signal.reason ?? new Error('aborted'));
    }, { once: true });
  });
}

export { apply, name, inject, Config };
