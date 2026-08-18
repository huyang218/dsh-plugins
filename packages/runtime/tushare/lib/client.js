/**
 * Tushare Pro client: one HTTP endpoint, per-interface quotas, and — the part
 * that matters most to an agent — errors that say what kind of failure this is.
 *
 * Tushare answers every call with HTTP 200 and reports failure in the body, so
 * a caller that only checks the status sees success. Worse, three very
 * different problems arrive as the same `code: 40203`: the token lacks the
 * points for this interface, the per-minute quota is exhausted, or the request
 * itself was malformed. They need opposite responses — one is permanent and
 * must be reported to the user, one clears by waiting, one is a bug — so this
 * module classifies them and refuses to blur them together.
 *
 * @module dsh-plugin-tushare/client
 */

/** Quota exhaustion: clears on its own, so it is worth waiting for. */
const RATE_LIMIT_PATTERN = /频率超限|每分钟最多访问该接口|rate limit/i;

/**
 * Insufficient points / no access. Permanent for this token: retrying wastes
 * the caller's time and ends in a timeout that reads like a network problem.
 */
const ACCESS_PATTERN = /没有(访问)?权限|积分|permission|not have access|抱歉，您所?(还没有|没有)/i;

/** A wrong or revoked token: permanent, and fixed by the user, not by us. */
const BAD_TOKEN_PATTERN = /token不对|token无效|token 不对|invalid token|请确认/i;

/** Failure kinds a caller can act on differently. */
const KIND = {
  NO_TOKEN: 'no-token',
  ACCESS: 'access-denied',
  RATE_LIMIT: 'rate-limited',
  PROVIDER: 'provider-error',
  TRANSPORT: 'transport',
};

/** Error carrying the classified failure kind plus Tushare's own wording. */
class TushareError extends Error {
  /**
   * @param {string} kind - One of {@link KIND}
   * @param {string} message - Model-facing explanation
   * @param {Object} [details] - `{ apiName, providerMessage }`
   */
  constructor(kind, message, details = {}) {
    super(message);
    this.name = 'TushareError';
    this.kind = kind;
    this.apiName = details.apiName;
    this.providerMessage = details.providerMessage;
  }
}

/**
 * What an agent should be told when the token cannot reach an interface.
 *
 * Spelled out because the failure mode we actually hit was not a crash: told
 * only that data was unavailable, the agent assembled numbers from elsewhere
 * and answered confidently. An access error must therefore end the task, not
 * redirect it.
 * @param {string} apiName - The Tushare interface
 * @param {string} providerMessage - Tushare's own message, which states the requirement
 * @returns {string} The message carried to the model
 */
function accessDeniedMessage(apiName, providerMessage) {
  return `Tushare 接口 ${apiName} 权限不足:${providerMessage}\n`
    + '这是账号权限问题,不是数据缺失,重试或换参数都不会成功——该接口按积分开放,'
    + '需要在 tushare.pro 提升积分或更换 token。请如实把这一点告诉用户,'
    + '不要改用其他来源推断、也不要编造这部分数据。';
}

/**
 * Sliding-window gate per interface. Tushare meters each interface separately,
 * and a whole-market window spends one call per trading day, so a wide request
 * exhausts the quota mid-scan without a gate. Queuing inside the quota beats
 * failing at call 300 of 400.
 * @param {Object} [options]
 * @param {number} [options.perMinute=450] - Calls allowed per window; 0 disables
 * @param {number} [options.windowMs=60000] - Window length
 * @param {Function} [options.now] - Clock, injected in tests
 * @param {Function} [options.wait] - Sleep, injected in tests
 * @returns {Function} `acquire(apiName, signal)`
 */
function createRateLimiter({ perMinute = 450, windowMs = 60_000, now = Date.now, wait = sleep } = {}) {
  const hits = new Map();
  return async function acquire(apiName, signal) {
    if (!perMinute) return;
    for (;;) {
      signal?.throwIfAborted();
      const stamps = hits.get(apiName) ?? [];
      const cutoff = now() - windowMs;
      const live = stamps.filter(at => at > cutoff);
      if (live.length < perMinute) {
        live.push(now());
        hits.set(apiName, live);
        return;
      }
      await wait(Math.max(1, live[0] - cutoff));
    }
  };
}

/** @param {number} ms - Milliseconds @returns {Promise<void>} */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Convert Tushare's columnar payload to row objects.
 * @param {{fields: string[], items: Array<Array<*>>}} data - Tushare data payload
 * @returns {Array<Object>} One object per row
 */
function rowsToObjects(data) {
  if (!data || !Array.isArray(data.fields) || !Array.isArray(data.items)) return [];
  return data.items.map(item => {
    const row = {};
    data.fields.forEach((field, index) => { row[field] = item[index]; });
    return row;
  });
}

/**
 * Create the query function bound to one token and endpoint.
 * @param {Object} options - `{ token, endpoint, limiter, retries, wait, fetchImpl }`
 * @returns {Function} `query({ apiName, params, fields, signal })`
 */
function createQuery({
  token, endpoint, limiter, retries = 2, wait = sleep, fetchImpl,
}) {
  // Resolved per call, not captured here: binding the global at creation
  // freezes whatever `fetch` existed when the plugin loaded.
  const send = (...args) => (fetchImpl ?? fetch)(...args);
  return async function query({ apiName, params = {}, fields = '', signal }) {
    if (!token) {
      throw new TushareError(
        KIND.NO_TOKEN,
        `Tushare 接口 ${apiName} 需要 token,但插件尚未配置。请让用户在 tushare 插件设置里填入 `
        + 'token(tushare.pro 注册后获取),不要用其他来源的数据代替。',
        { apiName },
      );
    }
    for (let attempt = 0; ; attempt++) {
      await limiter?.(apiName, signal);
      let response;
      try {
        response = await send(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ api_name: apiName, token, params, fields }),
          signal,
        });
      } catch (error) {
        if (signal?.aborted) throw error;
        throw new TushareError(KIND.TRANSPORT, `Tushare ${apiName} 请求失败:${error.message}`, { apiName });
      }
      if (!response.ok) {
        throw new TushareError(KIND.TRANSPORT, `Tushare ${apiName} HTTP ${response.status}`, { apiName });
      }
      const json = await response.json();
      if (json.code === 0) return rowsToObjects(json.data);

      const providerMessage = json.msg || `code ${json.code}`;
      if (BAD_TOKEN_PATTERN.test(providerMessage)) {
        throw new TushareError(
          KIND.NO_TOKEN,
          `Tushare 拒绝了当前 token(${apiName}):${providerMessage}\n`
          + '请让用户在 tushare 插件设置里换成有效的 token,不要用其他来源的数据代替。',
          { apiName, providerMessage },
        );
      }
      // Access is checked BEFORE rate limiting: both arrive as 40203, and a
      // permission problem retried as a quota problem just fails slower.
      if (ACCESS_PATTERN.test(providerMessage) && !RATE_LIMIT_PATTERN.test(providerMessage)) {
        throw new TushareError(KIND.ACCESS, accessDeniedMessage(apiName, providerMessage), {
          apiName, providerMessage,
        });
      }
      if (RATE_LIMIT_PATTERN.test(providerMessage)) {
        // The local gate cannot see calls this token makes elsewhere, so the
        // provider's own verdict still has to be survivable.
        if (attempt < retries) {
          await wait(Math.min(15_000, 3_000 * (attempt + 1)));
          continue;
        }
        throw new TushareError(
          KIND.RATE_LIMIT,
          `Tushare 接口 ${apiName} 频率超限且重试后仍未恢复:${providerMessage}。`
          + '稍后重试即可,或收窄请求范围减少调用次数。',
          { apiName, providerMessage },
        );
      }
      throw new TushareError(KIND.PROVIDER, `Tushare ${apiName} 返回错误:${providerMessage}`, {
        apiName, providerMessage,
      });
    }
  };
}

export {
  KIND, TushareError, createQuery, createRateLimiter, rowsToObjects, sleep,
  accessDeniedMessage, RATE_LIMIT_PATTERN, ACCESS_PATTERN, BAD_TOKEN_PATTERN,
};
