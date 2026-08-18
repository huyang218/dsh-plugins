import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as plugin from '../lib/index.js'

function ctxWith(services = {}) {
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

function fakeTushare(handlers = {}) {
  const calls = []
  return {
    configured: true, access: () => 'points', calls,
    query: async ({ apiName, params }) => {
      calls.push({ apiName, params })
      const handler = handlers[apiName]
      if (!handler) throw new Error(`unexpected interface ${apiName}`)
      return typeof handler === 'function' ? handler(params) : handler
    },
  }
}

const toolOf = (services, name) => {
  const ctx = ctxWith(services)
  plugin.apply(ctx, {})
  return { tool: ctx._tools.find(t => t.name === name), ctx }
}

test('exports the named plugin surface and no default export', () => {
  assert.ok(!('default' in plugin))
  assert.equal(plugin.name, 'ainfo')
  assert.ok(!plugin.name.startsWith('dsh-plugin-'))
  assert.deepEqual(plugin.inject, ['tools', 'systemPrompt'])
})

test('the credential section registers even without the provider', () => {
  const ctx = ctxWith()
  plugin.apply(ctx, {})
  assert.deepEqual(ctx._tools, [], 'no provider means no information tools')
  const section = ctx._sections.find(s => s.name === 'ainfo:data-sources')
  assert.ok(section)
  assert.match(section.text, /dsh-plugin-tushare/)
  assert.match(section.text, /do NOT substitute another/)
  assert.match(section.text, /astock/, 'the split from the data plugin has to be stated')
})

test('the provider unlocks three tools, each declaring the credential', () => {
  const ctx = ctxWith({ tushare: fakeTushare() })
  plugin.apply(ctx, {})
  assert.deepEqual(ctx._tools.map(t => t.name).sort(), ['ainfo_events', 'ainfo_news', 'ainfo_research'])
  for (const tool of ctx._tools) {
    assert.match(tool.description, /需要已配置 token/, `${tool.name} must state the credential`)
    assert.match(tool.description, /无免费替代/, `${tool.name} has no free source`)
  }
})

test('ainfo_news returns newest first and keeps headlines verbatim', async () => {
  const tushare = fakeTushare({
    major_news: () => [
      { title: '旧闻', pub_time: '2026-08-14 09:00:00', src: '新浪财经', content: 'x'.repeat(500) },
      { title: '新闻标题', pub_time: '2026-08-14 18:00:00', src: '新浪财经', content: '正文' },
      { title: '', pub_time: '2026-08-14 12:00:00' },
    ],
  })
  const { tool } = toolOf({ tushare }, 'ainfo_news')
  const value = await tool.execute({ startTime: '2026-08-14 09:00:00', endTime: '2026-08-14 23:00:00' }, {})
  assert.equal(value.count, 2, 'an untitled item carries no information')
  assert.equal(value.news[0].title, '新闻标题', 'newest first')
  assert.equal(value.news[0].excerpt, '正文', 'the headline is never paraphrased')
  assert.equal(value.news[1].excerpt.length, 300, 'a long body is bounded, not dropped')
  assert.equal(tushare.calls[0].params.start_date, '2026-08-14 09:00:00')
})

test('ainfo_research summarizes ratings without claiming them as fact', async () => {
  const tushare = fakeTushare({
    report_rc: () => [
      { ts_code: '600519.SH', name: '贵州茅台', report_date: '20260817', org_name: '天风证券', rating: '买入', target_price: 1600 },
      { ts_code: '600519.SH', name: '贵州茅台', report_date: '20260810', org_name: '中信证券', rating: '增持', target_price: 1500 },
    ],
  })
  const { tool } = toolOf({ tushare }, 'ainfo_research')
  const value = await tool.execute({ code: '600519' }, {})
  assert.equal(tushare.calls[0].params.ts_code, '600519.SH')
  assert.equal(value.reports[0].date, '20260817', 'newest first')
  assert.equal(value.reports[0].org, '天风证券')

  const text = tool.output.render({}, value)[0].text
  assert.match(text, /买入×1/)
  assert.match(text, /均值 1550\.00/)
  assert.match(text, /券商观点/, 'ratings must be attributed, not stated as fact')

  await assert.rejects(() => tool.execute({}, {}), /needs either a `code` or a `reportDate`/)
})

test('ainfo_events maps each kind to its interface and demands what it needs', async () => {
  const tushare = fakeTushare({
    forecast: () => [{ ts_code: '688052.SH', ann_date: '20260814', end_date: '20260630', type: '扭亏', p_change_min: 185.88 }],
    dividend: () => [{ ts_code: '600519.SH', end_date: '20260630', div_proc: '股东大会通过', cash_div: null }],
    stk_holdertrade: () => [{ ts_code: '600519.SH', ann_date: '20251230', holder_name: '茅台集团', in_de: 'IN', change_vol: 1000 }],
    share_float: () => [{ ts_code: '600519.SH', float_date: '20260901', float_share: 1000, holder_name: '某股东' }],
    top10_holders: () => [{ ts_code: '600519.SH', end_date: '20251231', holder_name: '工商银行', hold_ratio: 0.9242 }],
  })
  const { tool } = toolOf({ tushare }, 'ainfo_events')

  const forecast = await tool.execute({ kind: 'forecast', annDate: '20260814' }, {})
  assert.equal(tushare.calls.at(-1).apiName, 'forecast')
  assert.equal(forecast.events[0].type, '扭亏')
  assert.equal(forecast.events[0].changeMin, 185.88)

  const dividend = await tool.execute({ kind: 'dividend', code: '600519' }, {})
  // A dividend still in approval has no cash amount; 0 would read as "pays nothing".
  assert.ok(!('cashDividend' in dividend.events[0]))
  assert.equal(dividend.events[0].status, '股东大会通过')

  const trade = await tool.execute({ kind: 'holdertrade', code: '600519' }, {})
  assert.equal(trade.events[0].direction, 'increase')

  await tool.execute({ kind: 'float', code: '600519' }, {})
  await tool.execute({ kind: 'holders', code: '600519' }, {})

  await assert.rejects(() => tool.execute({ kind: 'nope' }, {}), /Unknown kind/)
  await assert.rejects(() => tool.execute({ kind: 'holders' }, {}), /needs a `code`/)
})

test('a news excerpt is plain text, not the feed’s article HTML', async () => {
  const { plainExcerpt, mapNews } = await import('../lib/sources.js')
  // Verbatim shape observed from the live feed.
  const body = '<div class="article-content-left">            <!-- 正文广告 -->'
    + '<style>.x{}</style><p>公司预计上半年净利润同比增长&nbsp;20%。</p></div>'
  const excerpt = plainExcerpt(body)
  assert.ok(!excerpt.includes('<'), 'markup must not reach the model')
  assert.ok(!excerpt.includes('正文广告'), 'comments are not article text')
  assert.match(excerpt, /公司预计上半年净利润同比增长 20%。/)

  assert.equal(plainExcerpt(''), undefined)
  assert.equal(plainExcerpt(null), undefined)
  assert.equal(plainExcerpt('<div></div>'), undefined, 'markup-only content carries nothing')
  assert.equal(plainExcerpt('x'.repeat(500)).length, 300, 'still bounded')

  const item = mapNews({ title: 't', pub_time: '2026-08-14 18:00:00', content: body })
  assert.ok(!item.excerpt.includes('<'))
})

test('a truncated summary says how much it left out', () => {
  // Five reports shown out of fifty read as the whole set unless the summary
  // says otherwise, and "what do analysts think" then gets answered from a
  // tenth of the evidence.
  const tushare = fakeTushare({
    report_rc: () => Array.from({ length: 50 }, (_, i) => ({
      ts_code: '600519.SH', report_date: '2026081' + (i % 9), org_name: '机构' + i, rating: '买入',
    })),
  })
  const { tool } = toolOf({ tushare }, 'ainfo_research')
  return tool.execute({ code: '600519', limit: 50 }, {}).then(value => {
    const text = tool.output.render({}, value)[0].text
    assert.match(text, /共 50 条/)
    assert.match(text, /规范值 reports\[\]/)
  })
})
