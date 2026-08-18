import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as plugin from '../lib/index.js'

/** Fake ctx capturing the provided service. */
function fakeCtx() {
  const provided = {}
  return { provide: (key, value) => { provided[key] = value }, on() {}, effect: fn => fn(), _provided: provided }
}

test('exports the named plugin surface and no default export', () => {
  assert.ok(!('default' in plugin), 'a default export would make the Loader drop the namespace')
  assert.equal(plugin.name, 'tushare')
  assert.ok(!plugin.name.startsWith('dsh-plugin-'), 'the package prefix belongs in package.json only')
  assert.equal(typeof plugin.apply, 'function')
})

test('Config defaults keep the plugin loadable without a token', () => {
  const resolved = new plugin.Config()
  assert.equal(resolved.token, '')
  assert.equal(resolved.endpoint, 'https://api.tushare.pro')
  assert.equal(resolved.maxPerMinute, 450)
})

test('apply provides the tushare service', () => {
  const ctx = fakeCtx()
  plugin.apply(ctx, new plugin.Config({ token: 'tok' }))
  const service = ctx._provided.tushare
  assert.ok(service, 'the service must be registered as `tushare`')
  assert.equal(service.configured, true)
  assert.equal(typeof service.query, 'function')
  assert.equal(typeof service.tradeDates, 'function')
})

test('an unconfigured provider still registers, and says so', () => {
  // Registering anyway is deliberate: a consumer waiting on an absent service
  // never loads, and its tools vanish with no explanation. A registered
  // service can fail with a message the user can act on.
  const ctx = fakeCtx()
  plugin.apply(ctx, new plugin.Config())
  assert.equal(ctx._provided.tushare.configured, false)
})

test('access metadata tells consumers which interfaces need a paid tier', () => {
  const ctx = fakeCtx()
  plugin.apply(ctx, new plugin.Config({ token: 'tok' }))
  const { access } = ctx._provided.tushare
  assert.equal(access('daily'), 'basic')
  assert.equal(access('trade_cal'), 'basic')
  assert.equal(access('income'), 'points')
  assert.equal(access('moneyflow'), 'points')
  assert.equal(access('cb_daily'), 'points')
  assert.equal(access('nope'), undefined)
})

test('tradeDates asks the exchange calendar and returns the trailing window', async () => {
  const ctx = fakeCtx()
  plugin.apply(ctx, new plugin.Config({ token: 'tok' }))
  const seen = []
  const real = globalThis.fetch
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body)
    seen.push(body)
    const days = ['20260728', '20260729', '20260730', '20260731', '20260803']
    // Tushare returns the calendar unsorted in practice.
    return new Response(JSON.stringify({ code: 0, data: { fields: ['cal_date'], items: [...days].reverse().map(d => [d]) } }))
  }
  try {
    const dates = await ctx._provided.tushare.tradeDates({ endDate: '20260803', count: 3 })
    assert.deepEqual(dates, ['20260730', '20260731', '20260803'])
    assert.equal(seen[0].api_name, 'trade_cal')
    assert.equal(seen[0].params.is_open, '1')
    assert.ok(seen[0].params.start_date < '20260803', 'the range must reach back before the end date')
  } finally {
    globalThis.fetch = real
  }
})
