import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as plugin from '../lib/index.js'
import { tokenNote, mapPeriodRow, periodLabel, INDICATOR_FIELDS } from '../lib/finance-tools.js'

/** ctx whose nested inject sees the given services. */
function ctxWith(services) {
  const tools = []
  const sections = []
  const ctx = {
    tools: { register: t => tools.push(t) },
    systemPrompt: { section: s => sections.push(s) },
    on() {}, effect: fn => fn(),
    inject: (names, body) => {
      if (names.every(n => services[n] !== undefined)) body({ ...ctx, ...services })
    },
    _tools: tools, _sections: sections,
  }
  return ctx
}

/** A `tushare` service answering from a handler map, logging every call. */
function fakeTushare(handlers, tradeDates = []) {
  const calls = []
  return {
    configured: true,
    access: () => 'points',
    calls,
    tradeDates: async ({ count }) => tradeDates.slice(-count),
    query: async ({ apiName, params }) => {
      calls.push({ apiName, params })
      const handler = handlers[apiName]
      if (!handler) throw new Error(`unexpected interface ${apiName}`)
      return typeof handler === 'function' ? handler(params) : handler
    },
  }
}

function toolOf(services, name) {
  const ctx = ctxWith(services)
  plugin.apply(ctx, new plugin.Config())
  return { tool: ctx._tools.find(t => t.name === name), ctx }
}

test('tokenNote states the credential, and names a free fallback when one exists', () => {
  const bare = tokenNote()
  assert.match(bare, /需要已配置 token/)
  assert.match(bare, /无免费替代/)
  assert.match(bare, /不要用其他来源推断或编造/)

  const withFree = tokenNote('astock_quote 有市盈率')
  assert.match(withFree, /免费替代:astock_quote 有市盈率/)
  assert.ok(!/无免费替代/.test(withFree))
})

test('mapPeriodRow keeps the period and omits metrics the issuer did not report', () => {
  const record = mapPeriodRow(
    { end_date: '20251231', roe: 34.462, grossprofit_margin: null, debt_to_assets: 16.4 },
    INDICATOR_FIELDS,
  )
  assert.equal(record.period, '20251231')
  assert.equal(record.roe, 34.462)
  assert.equal(record.debtToAssets, 16.4)
  // A bank reports no gross margin; a 0 there would read as "sells at cost".
  assert.ok(!('grossMargin' in record))
})

test('periodLabel names the quarterly cumulative reports', () => {
  assert.equal(periodLabel('20251231'), '2025 年报')
  assert.equal(periodLabel('20250630'), '2025 中报')
  assert.equal(periodLabel('20250930'), '2025 三季报')
})

test('astock_financials returns periods oldest-first and rejects an unknown report', async () => {
  const tushare = fakeTushare({
    fina_indicator: () => [
      { ts_code: '600519.SH', end_date: '20251231', roe: 34.4 },
      { ts_code: '600519.SH', end_date: '20250630', roe: 17.9 },
    ],
  })
  const { tool } = toolOf({ tushare }, 'astock_financials')
  const value = await tool.execute({ code: '600519', report: 'indicators', periods: 2 }, {})
  assert.deepEqual(value.periods.map(p => p.period), ['20250630', '20251231'],
    'a trend reads forward in time')
  assert.equal(value.code, '600519')
  assert.equal(tushare.calls[0].params.ts_code, '600519.SH')

  await assert.rejects(() => tool.execute({ code: '600519', report: 'nope' }, {}), /Unknown report/)
  // The summary must not dump every line item.
  const text = tool.output.render({}, value)[0].text
  assert.match(text, /2025 年报/)
  assert.ok(text.length < 900)
})

test('astock_moneyflow picks the interface per scope and demands what it needs', async () => {
  const tushare = fakeTushare({
    moneyflow: () => [{ ts_code: '600519.SH', trade_date: '20260814', net_mf_amount: -56635.53 }],
    moneyflow_hsgt: () => [{ trade_date: '20260814', north_money: 274469.36 }],
    top_list: () => [{ trade_date: '20260814', ts_code: '000582.SZ', name: '北部湾港', reason: '跌幅偏离', net_amount: -66961716.6 }],
  }, ['20260812', '20260813', '20260814'])
  const { tool } = toolOf({ tushare }, 'astock_moneyflow')

  const stock = await tool.execute({ scope: 'stock', code: '600519', days: 5 }, {})
  assert.equal(tushare.calls.at(-1).apiName, 'moneyflow')
  assert.equal(stock.rows[0].netAmount, -56635.53)

  // Stock Connect windows by date: `limit` is rejected by that interface.
  const north = await tool.execute({ scope: 'north', days: 3 }, {})
  const northCall = tushare.calls.at(-1)
  assert.equal(northCall.apiName, 'moneyflow_hsgt')
  assert.equal(northCall.params.start_date, '20260812')
  assert.equal(northCall.params.end_date, '20260814')
  assert.ok(!('limit' in northCall.params), 'moneyflow_hsgt rejects limit')
  assert.equal(north.rows[0].northMoney, 274469.36)

  const top = await tool.execute({ scope: 'toplist', tradeDate: '20260814' }, {})
  assert.equal(top.rows[0].name, '北部湾港')
  assert.equal(top.rows[0].reason, '跌幅偏离')

  await assert.rejects(() => tool.execute({ scope: 'stock' }, {}), /needs a `code`/)
  await assert.rejects(() => tool.execute({ scope: 'toplist' }, {}), /needs a `tradeDate`/)
  await assert.rejects(() => tool.execute({ scope: 'nope' }, {}), /Unknown scope/)
})

test('astock_convertible_bonds joins terms and the underlying to compute the premium', async () => {
  const tushare = fakeTushare({
    cb_daily: () => [{ ts_code: '113667.SH', trade_date: '20260814', close: 214.702, pct_chg: 4.28, bond_value: 112.2 }],
    cb_basic: () => [{
      ts_code: '113667.SH', bond_short_name: '春23转债', stk_code: '603890.SH',
      stk_short_name: '春秋电子', conv_price: 9.95, remain_size: 372375757.9, maturity_date: '20290317',
    }],
    daily: () => [{ ts_code: '603890.SH', close: 22.09 }],
  }, ['20260814'])
  const { tool } = toolOf({ tushare }, 'astock_convertible_bonds')

  const value = await tool.execute({ tradeDate: '20260814' }, {})
  const bond = value.bonds[0]
  assert.equal(bond.code, '113667')
  assert.equal(bond.stockCode, '603890')
  // conversion value = 100 / 9.95 × 22.09
  assert.ok(Math.abs(bond.convValue - 222.0100502512563) < 1e-9)
  assert.ok(Math.abs(bond.convPremium - (214.702 / 222.0100502512563 - 1)) < 1e-12)
  // One market-wide call for the underlyings, whatever the bond count.
  assert.equal(tushare.calls.filter(c => c.apiName === 'daily').length, 1)
})

test('a bond without a conversion price gets no premium rather than a fake one', async () => {
  const tushare = fakeTushare({
    cb_daily: () => [{ ts_code: '110092.SH', trade_date: '20260814', close: 70.6 }],
    // Pre-conversion window: Tushare reports no conversion price yet.
    cb_basic: () => [{ ts_code: '110092.SH', bond_short_name: '测试转债', stk_code: '600000.SH', conv_price: null }],
    daily: () => [{ ts_code: '600000.SH', close: 10 }],
  }, ['20260814'])
  const { tool } = toolOf({ tushare }, 'astock_convertible_bonds')
  const bond = (await tool.execute({ tradeDate: '20260814' }, {})).bonds[0]
  assert.ok(!('convPrice' in bond))
  assert.ok(!('convValue' in bond), 'no conversion price means no conversion value')
  assert.ok(!('convPremium' in bond))
  assert.equal(bond.close, 70.6)
})
