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
  assert.equal(plugin.name, 'dsh-plugin-astock')
  assert.deepEqual(plugin.inject, ['tools', 'systemPrompt'])
  assert.equal(typeof plugin.apply, 'function')
})

test('apply registers all four tools with matching prompt sections', () => {
  const ctx = fakeCtx()
  plugin.apply(ctx, {})

  const toolNames = ctx._tools.map(t => t.name).sort()
  assert.deepEqual(toolNames, ['astock_data', 'astock_indicators', 'astock_quote', 'astock_search'])

  const sectionNames = ctx._sections.map(s => s.name).sort()
  assert.deepEqual(sectionNames, [
    'tool:astock_data', 'tool:astock_indicators', 'tool:astock_quote', 'tool:astock_search',
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

test('astock_search render handles empty results', () => {
  const ctx = fakeCtx()
  plugin.apply(ctx, {})
  const tool = ctx._tools.find(t => t.name === 'astock_search')
  const rendered = tool.output.render({ keyword: 'nope' }, { results: [] })
  assert.match(rendered[0].text, /未找到/)
})
