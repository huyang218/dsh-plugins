import { test } from 'node:test'
import assert from 'node:assert/strict'

/**
 * Load the SHIPPED client bundle by standing in for the browser: the loader
 * table and React are what the host injects, so a fake pair of those runs the
 * real artifact. Testing a copy of the logic would not prove the file we
 * publish behaves this way.
 * @returns {Object} The bundle's exports
 */
function loadBundle() {
  let captured
  globalThis.window = {
    __ModuleLoader__: {
      load: ({ id, factory }) => {
        assert.equal(id, 'dsh-plugin-astock-chart', 'the id must match the package name')
        captured = factory(name => {
          if (name === 'react') return { createElement: (type, props, ...children) => ({ type, props, children }) }
          throw new Error(`unexpected external ${name}`)
        })
      },
    },
  }
  return import('../client/client.js').then(() => captured)
}

const bundle = await loadBundle()

test('the bundle registers itself in the loader factory form', () => {
  assert.equal(typeof bundle.apply, 'function')
  assert.equal(typeof bundle.parseSeries, 'function')
})

test('every service the plugin reads is declared in inject', () => {
  // Cordis refuses an undeclared property, and the failure is not a missing
  // card: the entry fails to apply and the browser shows "Failed to load
  // plugins". This is what that costs when it is only found by running it.
  assert.deepEqual(bundle.inject, ['slots'])

  const read = []
  const probe = new Proxy({}, {
    get: (_target, key) => {
      if (typeof key === 'string') read.push(key)
      return new Proxy(() => {}, { get: () => () => {}, apply: () => {} })
    },
  })
  bundle.apply(probe)
  const undeclared = [...new Set(read)].filter(key => !bundle.inject.includes(key))
  assert.deepEqual(undeclared, [], `apply() reads undeclared services: ${undeclared}`)
})

test('parseSeries decodes rows and drops bars without a full candle', () => {
  const bars = bundle.parseSeries('20260813,10,11,9,10.5,1000;20260814,10.5,12,10,11.8,2000')
  assert.equal(bars.length, 2)
  assert.deepEqual(bars[0], { date: '20260813', open: 10, high: 11, low: 9, close: 10.5, volume: 1000 })

  // An empty token means "not reported": Number('') is 0, which would draw a
  // candle crashing to zero.
  const partial = bundle.parseSeries('20260814,,12,10,11.8,2000')
  assert.deepEqual(partial, [], 'a bar missing a price cannot be drawn')

  // Volume alone may be absent; the candle is still valid.
  const noVolume = bundle.parseSeries('20260814,10,12,10,11.8,')
  assert.equal(noVolume.length, 1)
  assert.equal(noVolume[0].volume, undefined)

  assert.deepEqual(bundle.parseSeries(''), [])
  assert.deepEqual(bundle.parseSeries(undefined), [])
})

test('parseSeries keeps only the trailing window', () => {
  const packed = Array.from({ length: 200 }, (_, i) => `2026080${i % 9},1,2,0.5,1.5,10`).join(';')
  assert.equal(bundle.parseSeries(packed).length, bundle.MAX_BARS)
})

const box = { width: 100, height: 100, volumeHeight: 20, gap: 0 }

test('candleGeometry scales to the visible range, not to zero', () => {
  const bars = bundle.parseSeries('20260813,100,110,90,105,10;20260814,105,120,100,118,20')
  const geometry = bundle.candleGeometry(bars, box)
  assert.equal(geometry.min, 90)
  assert.equal(geometry.max, 120)
  // A 2% move must not render as a flat line at the top of an empty chart.
  assert.equal(geometry.candles[0].highY > geometry.candles[1].highY, true)
  assert.equal(geometry.candles.length, 2)
  assert.equal(geometry.candles[0].width, 50)
})

test('candleGeometry pads a flat range so the candle stays visible', () => {
  const bars = bundle.parseSeries('20260814,10,10,10,10,5')
  const geometry = bundle.candleGeometry(bars, box)
  assert.ok(geometry.max > geometry.min, 'a limit-locked day must not collapse the scale')
  assert.ok(geometry.candles[0].bodyHeight >= 1)
})

test('candleGeometry colours by direction and sizes volume against its own peak', () => {
  const bars = bundle.parseSeries('20260813,10,11,9,9.5,50;20260814,9.5,12,9,11,100')
  const geometry = bundle.candleGeometry(bars, box)
  assert.equal(geometry.candles[0].rising, false, 'close below open falls')
  assert.equal(geometry.candles[1].rising, true)
  assert.equal(geometry.volumes[1].height, 20, 'the busiest bar fills the volume band')
  assert.equal(geometry.volumes[0].height, 10)
})

test('candleGeometry survives an empty series and a volume-less series', () => {
  assert.deepEqual(bundle.candleGeometry([], box), { candles: [], volumes: [], min: 0, max: 0 })
  const noVolume = bundle.candleGeometry(bundle.parseSeries('20260814,10,12,9,11,'), box)
  assert.deepEqual(noVolume.volumes, [], 'no volume data draws no volume band')
})

test('readMeta ignores results that carry no drawable series', () => {
  assert.equal(bundle.readMeta(undefined), undefined)
  assert.equal(bundle.readMeta({}), undefined)
  assert.equal(bundle.readMeta({ meta: { code: '600519' } }), undefined, 'a result from before this card existed')
  assert.equal(bundle.readMeta({ meta: { series: '' } }), undefined)
  const ok = bundle.readMeta({ meta: { code: '600519', series: '20260814,10,12,9,11,100' } })
  assert.equal(ok.bars.length, 1)
})

test('the card renders nothing when there is no series, leaving the generic card', () => {
  // Returning null is the difference between "no chart here" and replacing a
  // useful generic card with a blank box.
  assert.equal(bundle.ChartCard({ block: { meta: undefined } }), null)
  assert.equal(bundle.ChartCard({ block: { isError: true, meta: { code: 'x' } } }), null)
})

test('the card renders a chart when the series is there', () => {
  const tree = bundle.ChartCard({
    block: {
      meta: {
        code: '600519', name: '贵州茅台', periodName: '日K线',
        series: '20260813,1300,1320,1290,1310,100;20260814,1310,1360,1300,1350,200',
      },
    },
  })
  assert.ok(tree, 'a drawable result must produce a card')
  const flat = JSON.stringify(tree)
  assert.match(flat, /贵州茅台/)
  assert.match(flat, /600519/)
  assert.match(flat, /svg/)
  assert.match(flat, /1350\.00/, 'the latest close belongs in the header')
})

test('apply registers the card under the astock_data tool name', () => {
  const registered = []
  bundle.apply({
    slots: {
      inject: (slot, body) => { assert.equal(slot, 'tool.call.toolview'); body() },
      register: (spec, component) => registered.push({ spec, component }),
    },
  })
  assert.equal(registered.length, 1)
  assert.equal(registered[0].spec.key, 'astock_data', 'keyed by the wire tool name')
  assert.equal(registered[0].component, bundle.ChartCard)
})
