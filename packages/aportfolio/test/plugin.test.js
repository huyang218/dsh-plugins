import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as plugin from '../lib/index.js'

/** An in-memory stand-in for the storage domain. */
function fakeStorage() {
  const tables = { positions: new Map(), watchlist: new Map() }
  const table = name => ({
    get: key => tables[name].get(key),
    entries: () => tables[name].entries(),
    get size() { return tables[name].size },
    put: async (key, value) => { tables[name].set(key, value) },
    delete: async key => tables[name].delete(key),
  })
  return { tables, domain: { table, close: async () => {} } }
}

function fakeCtx(storage) {
  const tools = []
  const sections = []
  const ctx = {
    tools: { register: t => tools.push(t) },
    systemPrompt: { section: s => sections.push(s) },
    on() {}, effect: fn => fn(),
    inject: (names, body) => {
      if (names.every(n => n === 'storageDomain' && storage)) {
        body({ ...ctx, storageDomain: { open: async () => storage.domain } })
      }
    },
    _tools: tools, _sections: sections,
  }
  return ctx
}

/** Build the plugin with storage and a stubbed quote source. */
async function ready(config = {}) {
  const storage = fakeStorage()
  const ctx = fakeCtx(storage)
  plugin.apply(ctx, new plugin.Config(config))
  await new Promise(resolve => setTimeout(resolve, 5))
  return { ctx, storage, tool: name => ctx._tools.find(t => t.name === name) }
}

/** Stub EastMoney's quote endpoint for the duration of one test. */
function stubQuotes(t, prices) {
  const real = globalThis.fetch
  t.after(() => { globalThis.fetch = real })
  globalThis.fetch = async (url) => {
    const code = new URL(url).searchParams.get('secid').split('.')[1]
    const price = prices[code]
    if (price === undefined) throw new TypeError('fetch failed')
    return new Response(JSON.stringify({ data: { f43: price * 100, f58: '名' + code, f60: price * 100, f170: 0 } }))
  }
}

test('exports the named plugin surface and no default export', () => {
  assert.ok(!('default' in plugin))
  assert.equal(plugin.name, 'aportfolio')
  assert.ok(!plugin.name.startsWith('dsh-plugin-'))
  assert.deepEqual(plugin.inject, ['tools', 'systemPrompt'])
})

test('the state section registers even without storage, and the tools do not', () => {
  const ctx = fakeCtx(undefined)
  plugin.apply(ctx, new plugin.Config())
  assert.deepEqual(ctx._tools, [])
  const section = ctx._sections.find(s => s.name === 'aportfolio:state')
  assert.ok(section)
  assert.match(section.text, /never invent, guess/, 'the model must not fabricate a position')
})

test('editing stores exactly what was passed and survives as state', async () => {
  const { storage, tool } = await ready()
  const edit = tool('aportfolio_edit')

  const set = await edit.execute({ action: 'set', kind: 'position', code: '600519', shares: 100, cost: 1200 }, {})
  assert.deepEqual(set, { action: 'set', kind: 'position', code: '600519', stored: true, entries: 1 })
  const stored = storage.tables.positions.get('600519')
  assert.equal(stored.shares, 100)
  assert.equal(stored.cost, 1200)

  // A set REPLACES: the tool takes a full position, never a delta.
  await edit.execute({ action: 'set', kind: 'position', code: '600519', shares: 150, cost: 1250 }, {})
  assert.equal(storage.tables.positions.get('600519').shares, 150)
  assert.equal(storage.tables.positions.size, 1)

  const removed = await edit.execute({ action: 'remove', kind: 'position', code: '600519' }, {})
  assert.equal(removed.stored, true)
  assert.equal(storage.tables.positions.size, 0)

  const again = await edit.execute({ action: 'remove', kind: 'position', code: '600519' }, {})
  assert.equal(again.stored, false, 'removing what is not there is not an error')
})

test('editing rejects what it cannot honestly record', async () => {
  const { tool } = await ready({ maxEntries: 2 })
  const edit = tool('aportfolio_edit')
  await assert.rejects(() => edit.execute({ action: 'set', kind: 'position', code: '600519' }, {}), /shares/)
  await assert.rejects(() => edit.execute({ action: 'set', kind: 'nope', code: '600519' }, {}), /Unknown kind/)
  await assert.rejects(() => edit.execute({ action: 'nope', kind: 'watch', code: '600519' }, {}), /Unknown action/)
  await assert.rejects(() => edit.execute({ action: 'set', kind: 'watch', code: 'ABC' }, {}), /six-digit/)

  // At the limit, refuse rather than evict: a silently dropped holding is a
  // wrong portfolio the user cannot notice.
  await edit.execute({ action: 'set', kind: 'watch', code: '600519' }, {})
  await edit.execute({ action: 'set', kind: 'watch', code: '000001' }, {})
  await assert.rejects(() => edit.execute({ action: 'set', kind: 'watch', code: '300750' }, {}), /上限/)
  // Updating an existing entry at the limit is still allowed.
  await edit.execute({ action: 'set', kind: 'watch', code: '600519', note: 'x' }, {})
})

test('viewing prices holdings live and reports what it could not price', async (t) => {
  const { tool } = await ready()
  const edit = tool('aportfolio_edit')
  await edit.execute({ action: 'set', kind: 'position', code: '600519', shares: 100, cost: 1200 }, {})
  await edit.execute({ action: 'set', kind: 'position', code: '000001', shares: 1000, cost: 10 }, {})
  await edit.execute({ action: 'set', kind: 'watch', code: '300750', targetBuy: 200 }, {})

  stubQuotes(t, { 600519: 1300, 300750: 180 })          // 000001 deliberately unreachable
  const value = await tool('aportfolio_view').execute({ scope: 'all' }, {})

  assert.equal(value.positions.length, 2)
  assert.equal(value.unpriced, 1)
  assert.equal(value.marketValue, 130_000, 'the unpriced holding is excluded, not counted as zero')
  assert.equal(value.watchlist[0].hit, 'buy', '180 is at or below the 200 buy target')

  const text = tool('aportfolio_view').output.render({}, value)[0].text
  assert.match(text, /取价失败/)
  assert.match(text, /不要当作完整数字/, 'a partial total must say it is partial')
})

test('an empty book reads as empty rather than as a zero portfolio', async () => {
  const { tool } = await ready()
  const value = await tool('aportfolio_view').execute({ scope: 'all' }, {})
  assert.deepEqual(value.positions, [])
  const text = tool('aportfolio_view').output.render({}, value)[0].text
  assert.match(text, /还没有记录任何持仓/)
  assert.match(text, /自选列表是空的/)
})
