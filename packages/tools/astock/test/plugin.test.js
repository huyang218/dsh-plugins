import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as plugin from '../lib/index.js'

/**
 * Minimal fake Context: captures registrations. `apply` runs the real
 * `defineTool`, so schema violations (e.g. a missing additionalProperties)
 * throw right here without booting dsh.
 *
 * `inject` mirrors Cordis: the body runs only when every named service is
 * present. Passing no `tushare` is therefore the real "provider not
 * installed" case, which must still leave the free tools registered.
 * @param {Object} [services] - Services available to nested `ctx.inject`
 * @returns {Object} The fake context
 */
function fakeCtx(services = {}) {
  const tools = []
  const sections = []
  const ctx = {
    tools: { register: (tool) => tools.push(tool) },
    systemPrompt: { section: (s) => sections.push(s) },
    on: () => {},
    effect: (fn) => fn(),
    inject: (names, body) => {
      if (names.every(name => services[name] !== undefined)) body({ ...ctx, ...services })
    },
    _tools: tools,
    _sections: sections,
  }
  return ctx
}

/** A stand-in `tushare` service whose query answers from a handler map. */
function fakeTushare(handlers = {}, tradeDates = []) {
  const calls = []
  return {
    configured: true,
    access: () => 'points',
    calls,
    // Mirrors the real service: the calendar is trimmed to the requested
    // window, which is what makes a narrower repeat call reindex its rows.
    tradeDates: async ({ count }) => tradeDates.slice(-count),
    query: async ({ apiName, params, fields }) => {
      calls.push({ apiName, params, fields })
      const handler = handlers[apiName]
      if (!handler) throw new Error(`unexpected interface ${apiName}`)
      return typeof handler === 'function' ? handler(params) : handler
    },
  }
}

test('exports the named plugin surface and no default export', () => {
  assert.ok(!('default' in plugin), 'default export would make the Loader drop name/inject')
  // Upstream convention: the exported name is the SHORT plugin name (loader
  // diagnostics), not the package name — dsh-storage-domain exports
  // 'storage-domain', dsh-tool-bash exports 'tool-bash'.
  assert.equal(plugin.name, 'astock')
  assert.ok(!plugin.name.startsWith('dsh-plugin-'), 'the package prefix belongs in package.json only')
  assert.deepEqual(plugin.inject, ['tools', 'systemPrompt'])
  assert.equal(typeof plugin.apply, 'function')
})

test('Config no longer carries Tushare credentials — the provider owns them', () => {
  const resolved = new plugin.Config()
  assert.ok(!('tushareToken' in resolved), 'a second token field would be configured twice and metered separately')
  assert.ok(!('tushareEndpoint' in resolved))
  assert.equal(resolved.marketMaxDays, 120, 'market settings stay with the plugin that uses them')
})

test('the credential map is registered even without the provider', () => {
  // Without it, a missing Tushare tool looks to the model like the capability
  // does not exist, instead of like a plugin that is not installed.
  const ctx = fakeCtx()
  plugin.apply(ctx, new plugin.Config())
  const section = ctx._sections.find(s => s.name === 'astock:data-sources')
  assert.ok(section, 'the data-source section must always register')
  assert.match(section.text, /FREE, no credentials/)
  assert.match(section.text, /dsh-plugin-tushare/)
  assert.match(section.text, /do NOT substitute another source/)
})

test('astock_market_quotes registers without a token and renders a summary', () => {
  const ctx = fakeCtx()
  plugin.apply(ctx, new plugin.Config())
  const tool = ctx._tools.find(t => t.name === 'astock_market_quotes')
  assert.ok(tool, 'the whole-market sweep needs no Tushare token')
  assert.ok(ctx._sections.some(s => s.name === 'tool:astock_market_quotes'))

  // The renderer must summarize: thousands of rows must never reach the model
  // as text — the canonical value carries them for Code Mode.
  const stocks = Array.from({ length: 5000 }, (_, i) => ({
    code: String(i).padStart(6, '0'), name: `股票${i}`, isSt: i % 100 === 0,
    price: 10 + i / 1000, circulatingMarketCap: 6e9,
  }))
  const text = tool.output.render({}, { count: stocks.length, stocks })[0].text
  assert.match(text, /5000 只股票/)
  assert.ok(text.length < 800, `render must stay a summary, got ${text.length} chars`)
  assert.ok(!text.includes('股票4999'), 'render must not enumerate the market')
})

test('astock_market_bars registers only with a token and clamps the window', async () => {
  const bare = fakeCtx()
  plugin.apply(bare, new plugin.Config())
  assert.ok(!bare._tools.some(t => t.name === 'astock_market_bars'),
    'without the provider installed the Tushare tools must not register')

  const days = ['20260728', '20260729', '20260730', '20260731', '20260803']
  const requested = []
  const tushare = fakeTushare({
    daily: params => {
      requested.push(params.trade_date)
      return [{
        ts_code: '000001.SZ', trade_date: params.trade_date, open: 11.5, high: 11.7,
        low: 11.44, close: 11.62, pre_close: 11.5, pct_chg: 1, vol: 10, amount: 20,
      }]
    },
  }, days)
  const ctx = fakeCtx({ tushare })
  plugin.apply(ctx, new plugin.Config({ marketMaxDays: 5 }))
  const tool = ctx._tools.find(t => t.name === 'astock_market_bars')
  assert.ok(tool)
  {
    // 999 days requested, but marketMaxDays caps the window at 5.
    const value = await tool.execute({ endDate: '20260803', days: 999 }, { signal: undefined })
    assert.equal(value.tradeDates.length, 5)
    assert.equal(requested.length, 5, 'one request per trading day, not per stock')
    assert.equal(value.count, 5)
    assert.deepEqual(value.codes, ['000001'])
    // One packed row per stock, bars in ascending day order whatever order the
    // concurrent per-day requests landed in.
    assert.equal(value.rows.length, 1)
    assert.deepEqual(
      value.rows[0].split(';').map(row => Number(row.split(',')[0])),
      [0, 1, 2, 3, 4],
    )
    assert.equal(value.rows[0].split(';')[0], '0,11.5,11.7,11.44,11.62,11.5,1,10,20')
    const text = tool.output.render({}, value)[0].text
    assert.match(text, /1 只股票 × 5 个交易日/)
  }
})

test('astock_market_bars packs absent metrics as empty tokens, never as 0', async () => {
  const tushare = fakeTushare({
    // A freshly listed stock reports no pre_close/pct_chg.
    daily: params => [{
      ts_code: '000001.SZ', trade_date: params.trade_date, open: 11.5, high: 11.7,
      low: 11.44, close: 11.62, pre_close: null, pct_chg: null, vol: 10, amount: 20,
    }],
  }, ['20260803'])
  const ctx = fakeCtx({ tushare })
  plugin.apply(ctx, new plugin.Config())
  const tool = ctx._tools.find(t => t.name === 'astock_market_bars')

  const real = globalThis.fetch
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body)
    if (body.api_name === 'trade_cal') {
      return new Response(JSON.stringify({
        code: 0, data: { fields: ['cal_date'], items: [['20260803']] },
      }))
    }
    return new Response(JSON.stringify({
      code: 0,
      data: {
        fields: ['ts_code', 'trade_date', 'open', 'high', 'low', 'close', 'pre_close', 'pct_chg', 'vol', 'amount'],
        // A freshly listed stock reports no pre_close/pct_chg.
        items: [['000001.SZ', '20260803', 11.5, 11.7, 11.44, 11.62, null, null, 10, 20]],
      },
    }))
  }
  try {
    const value = await tool.execute({ endDate: '20260803', days: 1 }, { signal: undefined })
    assert.equal(value.rows[0], '0,11.5,11.7,11.44,11.62,,,10,20')
    const [, , , , , preClose, pctChg] = value.rows[0]
      .split(',')
      .map(token => (token === '' ? undefined : Number(token)))
    assert.equal(preClose, undefined, 'an absent metric must not decode to 0')
    assert.equal(pctChg, undefined)
  } finally {
    globalThis.fetch = real
  }
})

/**
 * A `tushare` service serving one stock per requested trading day, plus the
 * list of days it was actually asked for — the cache assertions below are
 * about that list, not about the returned bars.
 * @param {string[]} tradeDates - Calendar the service reports
 * @returns {{service: Object, requested: string[]}} The stand-in and its log
 */
function marketBarsService(tradeDates) {
  const requested = []
  const service = fakeTushare({
    daily: params => {
      requested.push(params.trade_date)
      return [{
        ts_code: '000001.SZ', trade_date: params.trade_date, open: 11.5, high: 11.7,
        low: 11.44, close: 11.62, pre_close: 11.5, pct_chg: 1, vol: 10, amount: 20,
      }]
    },
  }, tradeDates)
  return { service, requested }
}

test('astock_market_bars serves a repeated window from the closed-day cache', async () => {
  const { service, requested } = marketBarsService(['20260731', '20260801', '20260802', '20260803'])
  const ctx = fakeCtx({ tushare: service })
  plugin.apply(ctx, new plugin.Config())
  const tool = ctx._tools.find(t2 => t2.name === 'astock_market_bars')

  const first = await tool.execute({ endDate: '20260803', days: 4 }, { signal: undefined })
  assert.equal(requested.length, 4)
  const second = await tool.execute({ endDate: '20260803', days: 4 }, { signal: undefined })
  assert.equal(requested.length, 4, 'closed days never need a second request')
  assert.deepEqual(second, first, 'the cached window rebuilds the same value')

  // A narrower window reuses the same days at their NEW indices: di indexes
  // this call's tradeDates, so a cached row must not carry a stale one.
  const narrow = await tool.execute({ endDate: '20260803', days: 2 }, { signal: undefined })
  assert.equal(requested.length, 4, 'still no new requests')
  assert.deepEqual(narrow.tradeDates, ['20260802', '20260803'])
  assert.deepEqual(
    narrow.rows[0].split(';').map(row => Number(row.split(',')[0])),
    [0, 1],
  )
})

test('astock_market_bars refetches the current day instead of caching it', async () => {
  // Today's session is still being written, so its bars are not immutable.
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date()).replace(/-/g, '')
  const { service, requested } = marketBarsService([today])
  const ctx = fakeCtx({ tushare: service })
  plugin.apply(ctx, new plugin.Config())
  const tool = ctx._tools.find(t2 => t2.name === 'astock_market_bars')

  await tool.execute({ endDate: today, days: 1 }, { signal: undefined })
  await tool.execute({ endDate: today, days: 1 }, { signal: undefined })
  assert.deepEqual(requested, [today, today])
})

test('astock_market_bars refuses an over-budget window after one probe request', async () => {
  const requested = []
  const tushare = fakeTushare({
    daily: params => {
      requested.push(params.trade_date)
      return ['000001.SZ', '000002.SZ', '000003.SZ'].map(code => ({
        ts_code: code, trade_date: params.trade_date, open: 11.5, high: 11.7,
        low: 11.44, close: 11.62, pre_close: 11.5, pct_chg: 1, vol: 10, amount: 20,
      }))
    },
  }, ['20260731', '20260801', '20260802', '20260803'])
  const ctx = fakeCtx({ tushare })
  // 3 stocks × 4 days = 12 bars, budget 6.
  plugin.apply(ctx, new plugin.Config({ marketMaxBars: 6 }))
  const tool = ctx._tools.find(t => t.name === 'astock_market_bars')

  {
    await assert.rejects(
      tool.execute({ endDate: '20260803', days: 4 }, { signal: undefined }),
      /窗口过大.*days 降到 2/s,
    )
    assert.deepEqual(requested, ['20260803'], 'refuse after the probe, not after the window')
  }
})

test('astock_fundamentals registers only once the provider is available', () => {
  const bare = fakeCtx()
  plugin.apply(bare, new plugin.Config())
  assert.ok(!bare._tools.some(t => t.name === 'astock_fundamentals'))

  const withProvider = fakeCtx({ tushare: fakeTushare() })
  plugin.apply(withProvider, new plugin.Config())
  const tool = withProvider._tools.find(t => t.name === 'astock_fundamentals')
  assert.ok(tool, 'the fundamentals tool must register once `tushare` is provided')
  assert.ok(withProvider._sections.some(s => s.name === 'tool:astock_fundamentals'))

  // Render is pure and omitted metrics (null from Tushare) must not break it.
  const rendered = tool.output.render({}, {
    tsCode: '600519.SH', tradeDate: '20260814', close: 1341.99, peTtm: 18.8, pb: 7.1,
  })
  assert.match(rendered[0].text, /600519\.SH/)
  assert.match(rendered[0].text, /市盈率TTM/)
  assert.ok(!rendered[0].text.includes('股息率'), 'absent metrics are not rendered')
})

test('apply registers the token-free tools with matching prompt sections', () => {
  const ctx = fakeCtx()
  plugin.apply(ctx, {})

  const toolNames = ctx._tools.map(t => t.name).sort()
  assert.deepEqual(toolNames, [
    'astock_data', 'astock_indicators', 'astock_market_quotes', 'astock_quote', 'astock_search',
  ])

  const sectionNames = ctx._sections.map(s => s.name).sort()
  assert.deepEqual(sectionNames, [
    'astock:data-sources',
    'tool:astock_data', 'tool:astock_indicators', 'tool:astock_market_quotes',
    'tool:astock_quote', 'tool:astock_search',
  ])

  for (const tool of ctx._tools) {
    assert.equal(typeof tool.execute, 'function', `${tool.name} must have execute`)
    assert.ok(tool.timeoutMs > 0, `${tool.name} must declare timeoutMs`)
  }
})

test('astock_data render is a pure projection of the canonical value', () => {
  const ctx = fakeCtx()
  plugin.apply(ctx, {})
  const tool = ctx._tools.find(t => t.name === 'astock_data')
  const value = {
    code: '600519', name: '贵州茅台', market: 'SH', period: 'daily', periodName: '日K线', total: 1,
    klines: [{
      date: '2026-08-14', open: 1400, close: 1410, high: 1420, low: 1390,
      volume: 25000, amount: 3.5e9, amplitude: 2.1, changePct: 0.71, change: 10, turnoverRate: 0.2,
    }],
  }
  const rendered = tool.output.render({}, value)
  assert.equal(rendered[0].type, 'text')
  assert.match(rendered[0].text, /贵州茅台/)
  assert.match(rendered[0].text, /600519/)
  assert.match(rendered[0].text, /2026-08-14/)
})

test('astock_quote canonical value conforms to its closed output schema', async () => {
  const ctx = fakeCtx()
  plugin.apply(ctx, {})
  const tool = ctx._tools.find(t => t.name === 'astock_quote')
  const declared = Object.keys(tool.output.schema.properties)
  // Every key mapQuote can emit must be declared: an undeclared key under
  // additionalProperties:false turns the whole call into isError at runtime.
  const { mapQuote } = await import('../lib/data.js')
  const sample = mapQuote('600519', {
    f58: 'x', f46: 1, f44: 1, f45: 1, f43: 1, f60: 1, f47: 1, f48: 1,
    f51: 1, f52: 1, f169: 1, f170: 1, f168: 1, f171: 1, f162: 1, f116: 1, f117: 1,
  })
  for (const key of Object.keys(sample)) {
    assert.ok(declared.includes(key), `quote returns undeclared key: ${key}`)
  }
})

test('astock_indicators render needs only the canonical value and args', async () => {
  const ctx = fakeCtx()
  plugin.apply(ctx, {})
  const tool = ctx._tools.find(t => t.name === 'astock_indicators')
  const { calculateAllIndicators } = await import('../lib/indicators.js')
  const klines = Array.from({ length: 70 }, (_, i) => ({
    date: `d${i}`, open: 10 + i, high: 11 + i, low: 9 + i, close: 10.5 + i, volume: 1000,
  }))
  const value = {
    code: '600519', name: 'x', period: 'daily', periodName: '日K线',
    total: klines.length, klines, indicators: calculateAllIndicators(klines),
  }
  // The old implementation smuggled `_options` through the canonical value,
  // which violated the closed schema; render must work without it.
  const rendered = tool.output.render({}, value)
  assert.match(rendered[0].text, /MA5=/)
  assert.match(rendered[0].text, /MACD/)
})

test('astock_search render handles empty results', () => {
  const ctx = fakeCtx()
  plugin.apply(ctx, {})
  const tool = ctx._tools.find(t => t.name === 'astock_search')
  const rendered = tool.output.render({ keyword: 'nope' }, { results: [] })
  assert.match(rendered[0].text, /未找到/)
})

test('batch summaries warn that their data is unreachable outside run_code', () => {
  const ctx = fakeCtx({ tushare: fakeTushare() })
  plugin.apply(ctx, new plugin.Config())

  const quotes = ctx._tools.find(t => t.name === 'astock_market_quotes')
  const quotesText = quotes.output.render({}, { count: 1, stocks: [{ code: '000001', name: 'x', isSt: false }] })[0].text
  assert.match(quotesText, /run_code/, 'a native caller must be told where the data lives')
  assert.match(quotesText, /不要.*编造|不要根据本摘要猜测/, 'and must be told not to invent one')

  const bars = ctx._tools.find(t => t.name === 'astock_market_bars')
  const barsText = bars.output.render({}, {
    tradeDates: ['20260814'], codes: ['000001'], fields: 'di,open,high,low,close',
    count: 1, rows: ['0,1,2,0.5,1.5'],
  })[0].text
  assert.match(barsText, /run_code/)
})

test('the provider unlocks exactly the Tushare-backed tools', () => {
  const free = fakeCtx()
  plugin.apply(free, new plugin.Config())
  const withProvider = fakeCtx({ tushare: fakeTushare() })
  plugin.apply(withProvider, new plugin.Config())

  const freeNames = free._tools.map(t => t.name).sort()
  const allNames = withProvider._tools.map(t => t.name).sort()
  const unlocked = allNames.filter(name => !freeNames.includes(name))
  assert.deepEqual(unlocked, [
    'astock_convertible_bonds', 'astock_financials', 'astock_fundamentals',
    'astock_market_bars', 'astock_moneyflow',
  ])

  // Every unlocked tool must say in its own description that it needs the
  // token, so the model can route before it calls rather than after it fails.
  for (const name of unlocked) {
    const tool = withProvider._tools.find(t => t.name === name)
    assert.match(tool.description, /Tushare/, `${name} must name its data source`)
    assert.match(tool.description, /需要已配置 token/, `${name} must state the credential`)
  }
  // …and the free ones must not claim to.
  for (const name of freeNames) {
    const tool = free._tools.find(t => t.name === name)
    assert.ok(!/需要已配置 token/.test(tool.description), `${name} works without credentials`)
  }
})
