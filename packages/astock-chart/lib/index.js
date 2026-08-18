/**
 * DSH Plugin: A-share chart card (host half).
 *
 * The work of this plugin is its client half: a candlestick view registered
 * into the web client's `tool.call.toolview` slot for `astock_data`. The host
 * entry exists because only an ENABLED loader entry is scanned for a
 * `dsh.client` package — the row is what makes the browser bundle be served.
 *
 * It therefore registers nothing: no tools, no listeners, no services.
 *
 * @module dsh-plugin-astock-chart
 */

/** Cordis plugin name used by loader diagnostics. */
const name = 'astock-chart';

/**
 * Mount point for the client bundle; deliberately empty on the host.
 * @returns {void}
 */
function apply() {}

export { apply, name };
