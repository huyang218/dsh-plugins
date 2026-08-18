/**
 * Canonical-value helpers shared by the data providers.
 *
 * Tool outputs are validated against closed schemas and must be lossless
 * JSON, so a missing metric has to be an ABSENT key — never NaN, never a
 * silent 0. The providers spell absence differently (EastMoney sends '-',
 * Tushare sends null), and `Number(null)` is 0, which would turn "no P/E"
 * into "P/E of zero".
 *
 * @module dsh-plugin-astock/value
 */

/**
 * Coerce a provider field to a lossless finite number, or undefined.
 * @param {*} raw - Raw provider value
 * @returns {number|undefined} A finite number, or undefined when absent
 */
function finiteNumber(raw) {
  if (raw === null || raw === undefined || raw === '' || raw === '-') return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value)) return undefined;
  return Object.is(value, -0) ? 0 : value;
}

/**
 * Copy the finite numbers of `source` onto `target`, skipping absent ones.
 * @param {Object} target - Object to extend
 * @param {Object} source - Candidate numeric fields, keyed by canonical name
 * @returns {Object} The same target
 */
function assignFinite(target, source) {
  for (const [key, raw] of Object.entries(source)) {
    const value = finiteNumber(raw);
    if (value !== undefined) target[key] = value;
  }
  return target;
}

export { finiteNumber, assignFinite };
