/**
 * Retry decisions: pure functions over a tool name, an outcome and a config.
 *
 * Two questions have to be answered separately, and conflating them is how a
 * retry plugin corrupts data. "Is this failure transient?" is about the error.
 * "Is this tool safe to run twice?" is about the tool, and nothing in the tool
 * contract answers it — `isConcurrencySafe` is about overlap, not idempotence
 * — so only the operator can, by naming the tools.
 *
 * @module dsh-plugin-tool-retry/policy
 */

/**
 * Failures worth another attempt: the request never got an answer, or the
 * answer said "later". A wrong argument, a denial or a missing file will fail
 * identically forever, and retrying them only makes the user wait.
 */
const TRANSIENT = [
  /fetch failed/i,
  /UND_ERR_(SOCKET|CONNECT_TIMEOUT|HEADERS_TIMEOUT)/i,
  /ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|EPIPE/i,
  /socket hang up|network|temporarily unavailable/i,
  /\b(429|500|502|503|504)\b/,
  /rate.?limit|too many requests|频率超限/i,
  /timed? ?out|超时/i,
];

/**
 * Does this tool name match one of the operator's patterns?
 *
 * Patterns are literal names or a trailing `*` prefix — deliberately not
 * regular expressions, because this list decides what may be executed twice
 * and a stray `.` matching everything is not a mistake worth enabling.
 * @param {string} toolName - The tool being dispatched
 * @param {string[]} patterns - Configured patterns
 * @returns {boolean} True when the operator declared this tool repeatable
 */
function isRepeatable(toolName, patterns) {
  return (patterns ?? []).some(pattern => (pattern.endsWith('*')
    ? toolName.startsWith(pattern.slice(0, -1))
    : toolName === pattern));
}

/**
 * Is this failure the kind that might succeed next time?
 * @param {string} message - The failure text
 * @param {RegExp[]} [patterns] - Override for the transient set
 * @returns {boolean} True when another attempt is worth making
 */
function isTransient(message, patterns = TRANSIENT) {
  const text = String(message ?? '');
  return patterns.some(pattern => pattern.test(text));
}

/**
 * Delay before attempt `attempt` (1 = the first retry).
 *
 * Exponential with a cap, because the failures worth retrying are usually a
 * remote system under load, and a tight loop is how a client turns someone
 * else's brief overload into its own outage.
 * @param {number} attempt - 1-based retry number
 * @param {Object} options - `{ backoffMs, maxBackoffMs }`
 * @returns {number} Milliseconds to wait
 */
function backoffFor(attempt, { backoffMs = 500, maxBackoffMs = 8000 } = {}) {
  return Math.min(maxBackoffMs, backoffMs * 2 ** Math.max(0, attempt - 1));
}

/**
 * The failure text of a settled result, or of a thrown error.
 * @param {Object} outcome - `{ result }` or `{ error }`
 * @returns {string|undefined} The message, or undefined when it succeeded
 */
function failureOf({ result, error }) {
  if (error) return String(error?.message ?? error);
  if (!result?.isError) return undefined;
  const structured = result.error;
  const code = typeof structured?.code === 'string' ? structured.code : '';
  const message = typeof structured?.message === 'string' ? structured.message : '';
  if (code || message) return `${code} ${message}`.trim();
  const text = result.content?.find(block => block?.type === 'text')?.text;
  return typeof text === 'string' && text !== '' ? text : 'unknown error';
}

/**
 * Should this outcome be retried?
 * @param {Object} input - `{ toolName, outcome, attempt, config }`
 * @returns {{retry: boolean, reason: string, failure?: string}} The decision
 */
function decide({ toolName, outcome, attempt, config }) {
  const failure = failureOf(outcome);
  if (failure === undefined) return { retry: false, reason: 'succeeded' };
  if (!isRepeatable(toolName, config.retryTools)) {
    // The default: nothing is repeatable until an operator says so. A tool
    // that wrote, ordered or sent something would otherwise do it twice.
    return { retry: false, reason: 'not-declared-repeatable', failure };
  }
  if (attempt >= Math.max(1, config.maxAttempts ?? 3)) {
    return { retry: false, reason: 'attempts-exhausted', failure };
  }
  if (!isTransient(failure)) return { retry: false, reason: 'not-transient', failure };
  return { retry: true, reason: 'transient', failure };
}

/**
 * The note appended to a failure that was retried, so the model does not read
 * a persistent outage as one unlucky call.
 * @param {number} attempts - Attempts made in total
 * @param {string} toolName - The tool
 * @returns {string} A line for the failure text
 */
function exhaustedNote(attempts, toolName) {
  return `(${toolName} 已重试 ${attempts - 1} 次仍失败,共 ${attempts} 次尝试——`
    + '这不是偶发抖动,请如实报告,不要再原样重试。)';
}

export { TRANSIENT, isRepeatable, isTransient, backoffFor, failureOf, decide, exhaustedNote };
