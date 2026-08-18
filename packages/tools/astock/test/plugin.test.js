import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as plugin from '../lib/index.js'

/**
 * Minimal fake Context: captures registrations. `apply` runs the real
 * `defineTool`, so schema violations (e.g. a missing additionalProperties)
 * throw right here without booting dsh.
 */
function fakeCtx() {
  const tools = []
  const sections = []
  return {
    tools: { register: (tool) => tools.push(tool) },
    systemPrompt: { section: (s) => sections.push(s) },
    on: () => {},
    effect: (fn) => fn(),
    _tools: tools,
    _sections: sections,
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

test('Config schema fills defaults and keeps tushare disabled by default', () => {
  const resolved = new plugin.Config()
  assert.equal(resolved.tushareToken, '')
  assert.equal(resolved.tushareEndpoint, 'https://api.tushare.pro')
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
  assert.ok(!bare._tools.some(t => t.name === 'astock_market_bars'))

  const ctx = fakeCtx()
  plugin.apply(ctx, new plugin.Config({ tushareToken: 'tok', marketMaxDays: 5 }))
  const tool = ctx._tools.find(t => t.name === 'astock_market_bars')
  assert.ok(tool)

  const requested = []
  const real = globalThis.fetch
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body)
    if (body.api_name === 'trade_cal') {
      const days = ['20260728', '20260729', '20260730', '20260731', '20260803']
      return new Response(JSON.stringify({ code: 0, data: { fields: ['cal_date'], items: days.map(d => [d]) } }))
    }
    requested.push(body.params.trade_date)
    return new Response(JSON.stringify({
      code: 0,
      data: {
        fields: ['ts_code', 'trade_date', 'open', 'high', 'low', 'close', 'pre_close', 'pct_chg', 'vol', 'amount'],
        items: [['000001.SZ', body.params.trade_date, 11.5, 11.7, 11.44, 11.62, 11.5, 1, 10, 20]],
      },
    }))
  }
  try {
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
  } finally {
    globalThis.fetch = real
  }
})

test('astock_market_bars packs absent metrics as empty tokens, never as 0', async () => {
  const ctx = fakeCtx()
  plugin.apply(ctx, new plugin.Config({ tushareToken: 'tok' }))
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

/** Fake Tushare serving one stock per requested trading day. */
function stubMarketBars(t, tradeDates) {
  const requested = []
  const real = globalThis.fetch
  t.after(() => { globalThis.fetch = real })
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body)
    if (body.api_name === 'trade_cal') {
      return new Response(JSON.stringify({
        code: 0, data: { fields: ['cal_date'], items: tradeDates.map(d => [d]) },
      }))
    }
    requested.push(body.params.trade_date)
    return new Response(JSON.stringify({
      code: 0,
      data: {
        fields: ['ts_code', 'trade_date', 'open', 'high', 'low', 'close', 'pre_close', 'pct_chg', 'vol', 'amount'],
        items: [['000001.SZ', body.params.trade_date, 11.5, 11.7, 11.44, 11.62, 11.5, 1, 10, 20]],
      },
    }))
  }
  return requested
}

test('astock_market_bars serves a repeated window from the closed-day cache', async (t) => {
  const ctx = fakeCtx()
  plugin.apply(ctx, new plugin.Config({ tushareToken: 'tok' }))
  const tool = ctx._tools.find(t2 => t2.name === 'astock_market_bars')
  const requested = stubMarketBars(t, ['20260731', '20260801', '20260802', '20260803'])

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

test('astock_market_bars refetches the current day instead of caching it', async (t) => {
  const ctx = fakeCtx()
  plugin.apply(ctx, new plugin.Config({ tushareToken: 'tok' }))
  const tool = ctx._tools.find(t2 => t2.name === 'astock_market_bars')
  // Today's session is still being written, so its bars are not immutable.
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date()).replace(/-/g, '')
  const requested = stubMarketBars(t, [today])

  await tool.execute({ endDate: today, days: 1 }, { signal: undefined })
  await tool.execute({ endDate: today, days: 1 }, { signal: undefined })
  assert.deepEqual(requested, [today, today])
})

test('astock_market_bars refuses an over-budget window after one probe request', async () => {
  const ctx = fakeCtx()
  // 3 stocks × 4 days = 12 bars, budget 6.
  plugin.apply(ctx, new plugin.Config({ tushareToken: 'tok', marketMaxBars: 6 }))
  const tool = ctx._tools.find(t => t.name === 'astock_market_bars')

  const requested = []
  const real = globalThis.fetch
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body)
    if (body.api_name === 'trade_cal') {
      const days = ['20260731', '20260801', '20260802', '20260803']
      return new Response(JSON.stringify({
        code: 0, data: { fields: ['cal_date'], items: days.map(d => [d]) },
      }))
    }
    requested.push(body.params.trade_date)
    return new Response(JSON.stringify({
      code: 0,
      data: {
        fields: ['ts_code', 'trade_date', 'open', 'high', 'low', 'close', 'pre_close', 'pct_chg', 'vol', 'amount'],
        items: ['000001.SZ', '000002.SZ', '000003.SZ'].map(
          code => [code, body.params.trade_date, 11.5, 11.7, 11.44, 11.62, 11.5, 1, 10, 20],
        ),
      },
    }))
  }
  try {
    await assert.rejects(
      tool.execute({ endDate: '20260803', days: 4 }, { signal: undefined }),
      /窗口过大.*days 降到 2/s,
    )
    assert.deepEqual(requested, ['20260803'], 'refuse after the probe, not after the window')
  } finally {
    globalThis.fetch = real
  }
})

test('astock_fundamentals registers only when a tushareToken is configured', () => {
  const bare = fakeCtx()
  plugin.apply(bare, new plugin.Config())
  assert.ok(!bare._tools.some(t => t.name === 'astock_fundamentals'))

  const withToken = fakeCtx()
  plugin.apply(withToken, new plugin.Config({ tushareToken: 'tok' }))
  const tool = withToken._tools.find(t => t.name === 'astock_fundamentals')
  assert.ok(tool, 'fundamentals tool must register with a token')
  assert.ok(withToken._sections.some(s => s.name === 'tool:astock_fundamentals'))

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
  const ctx = fakeCtx()
  plugin.apply(ctx, new plugin.Config({ tushareToken: 'tok' }))

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
