/**
 * Tool health bookkeeping: pure state transitions, no I/O and no clock of its
 * own, so every rule here is testable by passing a timestamp.
 *
 * @module dsh-plugin-tool-health/health
 */

/** A tool with no record yet. */
function emptyRecord() {
  return { calls: 0, failures: 0, streak: 0 };
}

/**
 * Fold one outcome into a tool's record.
 *
 * `streak` counts CONSECUTIVE failures and resets on any success, because a
 * tool that fails one call in fifty is healthy while a tool that has failed
 * its last three is not — a plain failure ratio cannot tell those apart, and
 * the ratio only gets worse the longer a since-recovered outage stays in it.
 * @param {Object} record - Existing record, or undefined
 * @param {Object} outcome - `{ ok, at, error }`
 * @returns {Object} The updated record
 */
function fold(record, { ok, at, error }) {
  const next = { ...emptyRecord(), ...record };
  next.calls += 1;
  if (ok) {
    next.streak = 0;
    next.lastOkAt = at;
    delete next.lastError;
  } else {
    next.failures += 1;
    next.streak += 1;
    next.lastFailAt = at;
    if (error) next.lastError = String(error).slice(0, 300);
  }
  return next;
}

/**
 * Is this tool currently considered broken?
 *
 * A failure only counts while it is recent: an outage from last week says
 * nothing about this session, and warning about it would teach the model to
 * avoid a tool that works. `staleMs` is what makes the memory forget.
 * @param {Object} record - The tool's record
 * @param {Object} options - `{ now, unhealthyAfter, staleMs }`
 * @returns {boolean} True when the model should be warned
 */
function isUnhealthy(record, { now, unhealthyAfter, staleMs }) {
  if (!record || record.streak < unhealthyAfter) return false;
  if (record.lastFailAt === undefined) return false;
  if (now - record.lastFailAt > staleMs) return false;
  // A success after the last failure clears it, whatever the streak says.
  return record.lastOkAt === undefined || record.lastOkAt < record.lastFailAt;
}

/** Human-readable age, e.g. "3 分钟前". */
function ago(from, now) {
  const seconds = Math.max(0, Math.round((now - from) / 1000));
  if (seconds < 90) return `${seconds} 秒前`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return `${minutes} 分钟前`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours} 小时前` : `${Math.round(hours / 24)} 天前`;
}

/**
 * The prompt text describing currently-broken tools.
 *
 * Returns '' when everything works: an empty context contributes nothing, and
 * a standing "all tools healthy" banner would spend tokens on every request to
 * say nothing. The wording tells the model what the record IS — evidence from
 * earlier calls — so it neither treats a stale outage as certain nor silently
 * ignores it.
 * @param {Map<string, Object>} records - toolName → record
 * @param {Object} options - `{ now, unhealthyAfter, staleMs, maxListed }`
 * @returns {string} Prompt text, or '' when nothing is worth saying
 */
function renderReport(records, { now, unhealthyAfter, staleMs, maxListed = 8 }) {
  const broken = [...records.entries()]
    .filter(([, record]) => isUnhealthy(record, { now, unhealthyAfter, staleMs }))
    .sort((a, b) => (b[1].lastFailAt ?? 0) - (a[1].lastFailAt ?? 0))
    .slice(0, maxListed);
  if (broken.length === 0) return '';

  const lines = [
    'Recent tool failures (observed in this and earlier sessions, newest first):',
  ];
  for (const [name, record] of broken) {
    const when = ago(record.lastFailAt, now);
    const recovery = record.lastOkAt === undefined
      ? 'never succeeded here'
      : `last succeeded ${ago(record.lastOkAt, now)}`;
    lines.push(`- ${name}: ${record.streak} consecutive failures, latest ${when} (${recovery})`);
    if (record.lastError) lines.push(`  last error: ${record.lastError}`);
  }
  lines.push(
    'This is evidence from past calls, not a prohibition: the cause may have cleared.',
    'Prefer a working alternative when one exists, and if you do call one of these and it',
    'fails again, tell the user the source is unavailable — do not substitute or invent data.',
  );
  return lines.join('\n');
}

export { emptyRecord, fold, isUnhealthy, ago, renderReport };
