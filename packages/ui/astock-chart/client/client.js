/**
 * dsh-plugin-astock-chart client bundle.
 *
 * Hand-written in the module loader's documented factory form
 * (`window.__ModuleLoader__.load({ id, factory })`) rather than produced by a
 * bundler. The card has no npm dependencies of its own — React and the UI
 * primitives arrive through the host-injected `require` table — so bundling
 * would add a toolchain, a build step and a build-authorization prompt on git
 * installs to concatenate one file with nothing.
 *
 * Everything below is plain ESM-free CommonJS inside the factory closure, and
 * the pure helpers are exported so tests can exercise the shipped artifact
 * itself rather than a copy of its logic.
 */
window.__ModuleLoader__.load({
  id: 'dsh-plugin-astock-chart',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const react = require('react')
    const h = react.createElement

    /** Bars a card will draw at most; the meta carries at most this many. */
    const MAX_BARS = 120

    /**
     * Decode the packed series produced by astock_data's presentationMeta.
     *
     * An EMPTY token means the issuer reported nothing for that field —
     * `Number('')` is 0, which would draw a candle crashing to zero — so the
     * empty string maps to undefined and the bar is dropped unless it has the
     * four prices a candle needs.
     * @param {string} packed - `date,open,high,low,close,volume` rows joined by `;`
     * @returns {Array<Object>} Usable bars, oldest first
     */
    function parseSeries(packed) {
      if (typeof packed !== 'string' || packed === '') return []
      const bars = []
      for (const row of packed.split(';')) {
        const parts = row.split(',')
        const num = index => (parts[index] === '' || parts[index] === undefined ? undefined : Number(parts[index]))
        const bar = {
          date: parts[0] ?? '',
          open: num(1), high: num(2), low: num(3), close: num(4), volume: num(5),
        }
        const priced = [bar.open, bar.high, bar.low, bar.close]
        if (priced.every(value => typeof value === 'number' && Number.isFinite(value))) bars.push(bar)
      }
      return bars.slice(-MAX_BARS)
    }

    /**
     * Geometry for one candlestick chart, in a 0..width / 0..height box.
     *
     * The price scale spans the visible highs and lows rather than starting at
     * zero: a stock that moved 2% would otherwise be a flat line at the top of
     * an empty chart. A zero-height range (one bar, or a limit-locked stretch)
     * is padded so the candle stays visible instead of collapsing.
     * @param {Array<Object>} bars - Parsed bars
     * @param {Object} box - `{ width, height, volumeHeight, gap }`
     * @returns {Object} `{ candles, volumes, min, max }`
     */
    function candleGeometry(bars, box) {
      const width = box.width
      const priceHeight = box.height - box.volumeHeight
      const gap = box.gap === undefined ? 1 : box.gap
      if (bars.length === 0) return { candles: [], volumes: [], min: 0, max: 0 }

      let min = Infinity
      let max = -Infinity
      let maxVolume = 0
      for (const bar of bars) {
        if (bar.low < min) min = bar.low
        if (bar.high > max) max = bar.high
        if (typeof bar.volume === 'number' && bar.volume > maxVolume) maxVolume = bar.volume
      }
      if (!(max > min)) { const pad = Math.abs(max) * 0.01 || 1; min = max - pad; max = max + pad }

      const slot = width / bars.length
      const body = Math.max(1, slot - gap)
      const y = price => priceHeight - ((price - min) / (max - min)) * priceHeight

      const candles = bars.map((bar, index) => {
        const x = index * slot
        const top = Math.min(bar.open, bar.close)
        const bottom = Math.max(bar.open, bar.close)
        return {
          date: bar.date,
          x, width: body, centre: x + body / 2,
          // A-share convention: rising is red, falling is green.
          rising: bar.close >= bar.open,
          highY: y(bar.high), lowY: y(bar.low),
          bodyY: y(bottom), bodyHeight: Math.max(1, y(top) - y(bottom)),
        }
      })

      const volumes = maxVolume <= 0 ? [] : bars.map((bar, index) => {
        const height = typeof bar.volume === 'number' ? (bar.volume / maxVolume) * box.volumeHeight : 0
        return {
          x: index * slot, width: body,
          y: box.height - height, height,
          rising: bar.close >= bar.open,
        }
      })

      return { candles, volumes, min, max }
    }

    /** Read the chart payload a settled astock_data result carries. */
    function readMeta(block) {
      const meta = block && block.meta
      if (!meta || typeof meta !== 'object') return undefined
      const bars = parseSeries(meta.series)
      if (bars.length === 0) return undefined
      return { meta, bars }
    }

    const COLORS = { rise: '#e5534b', fall: '#3fb950', axis: 'currentColor' }

    /** The candlestick card. */
    function ChartCard(props) {
      const payload = readMeta(props.block)
      // Running calls, failures and older results (recorded before this card
      // existed) have no series: returning null lets the generic card that
      // ui-tool already rendered stand, rather than replacing it with a blank.
      if (payload === undefined) return null
      const { meta, bars } = payload

      const box = { width: 640, height: 220, volumeHeight: 46, gap: 1 }
      const geometry = candleGeometry(bars, box)
      const last = bars[bars.length - 1]
      const first = bars[0]
      const change = first.close > 0 ? (last.close / first.close - 1) * 100 : 0

      const title = [meta.name, meta.code].filter(Boolean).join(' ')
        + (meta.periodName ? ' · ' + meta.periodName : '')
      const subtitle = bars.length + ' bars  ' + first.date + ' → ' + last.date
        + '   收 ' + last.close.toFixed(2)
        + '   区间 ' + (change >= 0 ? '+' : '') + change.toFixed(2) + '%'

      return h('div', { style: { fontSize: '12px', lineHeight: 1.5 } },
        h('div', { style: { fontWeight: 600 } }, title),
        h('div', { style: { opacity: 0.7, marginBottom: '6px' } }, subtitle),
        h('svg', {
          viewBox: '0 0 ' + box.width + ' ' + box.height,
          width: '100%', height: box.height,
          preserveAspectRatio: 'none', role: 'img', 'aria-label': title + ' candlestick chart',
        },
          geometry.volumes.map((bar, index) => h('rect', {
            key: 'v' + index, x: bar.x, y: bar.y, width: bar.width, height: bar.height,
            fill: bar.rising ? COLORS.rise : COLORS.fall, opacity: 0.35,
          })),
          geometry.candles.map((candle, index) => h('g', {
            key: 'c' + index, fill: candle.rising ? COLORS.rise : COLORS.fall,
            stroke: candle.rising ? COLORS.rise : COLORS.fall,
          },
            h('line', {
              x1: candle.centre, x2: candle.centre, y1: candle.highY, y2: candle.lowY, strokeWidth: 1,
            }),
            h('rect', { x: candle.x, y: candle.bodyY, width: candle.width, height: candle.bodyHeight }),
          )),
        ),
        h('div', { style: { display: 'flex', justifyContent: 'space-between', opacity: 0.6 } },
          h('span', null, geometry.min.toFixed(2)),
          h('span', null, geometry.max.toFixed(2)),
        ),
      )
    }

    /**
     * Register the card for astock_data.
     * @param {Object} ctx - Client plugin context
     */
    function apply(ctx) {
      ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({
        name: 'tool.call.toolview',
        key: 'astock_data',
      }, ChartCard))
    }

    exports.apply = apply
    exports.ChartCard = ChartCard
    exports.parseSeries = parseSeries
    exports.candleGeometry = candleGeometry
    exports.readMeta = readMeta
    exports.MAX_BARS = MAX_BARS
    return module.exports
  },
})
