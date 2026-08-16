import { test } from 'node:test'
import assert from 'node:assert/strict'
import { toTsCode, rowsToObjects, tushareQuery } from '../lib/tushare.js'

test('toTsCode maps prefixes to exchange suffixes', () => {
  assert.equal(toTsCode('600519'), '600519.SH')
  assert.equal(toTsCode('000001'), '000001.SZ')
  assert.equal(toTsCode('300750'), '300750.SZ')
  assert.equal(toTsCode('830799'), '830799.BJ')
  assert.equal(toTsCode('sz000001'), '000001.SZ')
  assert.equal(toTsCode('600519.SH'), '600519.SH') // already ts_code: unchanged
})

test('rowsToObjects zips fields with items and tolerates malformed payloads', () => {
  assert.deepEqual(
    rowsToObjects({ fields: ['a', 'b'], items: [[1, 2], [3, null]] }),
    [{ a: 1, b: 2 }, { a: 3, b: null }],
  )
  assert.deepEqual(rowsToObjects(null), [])
  assert.deepEqual(rowsToObjects({}), [])
})

test('tushareQuery posts the request shape and surfaces API errors', async (t) => {
  const calls = []
  const realFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = realFetch })

  globalThis.fetch = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) })
    return new Response(JSON.stringify({
      code: 0, msg: null,
      data: { fields: ['ts_code', 'pe'], items: [['600519.SH', 18.8]] },
    }))
  }
  const rows = await tushareQuery({
    endpoint: 'https://example.test', token: 'tok', apiName: 'daily_basic',
    params: { ts_code: '600519.SH' }, fields: 'ts_code,pe',
  })
  assert.deepEqual(rows, [{ ts_code: '600519.SH', pe: 18.8 }])
  assert.equal(calls[0].url, 'https://example.test')
  assert.deepEqual(calls[0].body, {
    api_name: 'daily_basic', token: 'tok',
    params: { ts_code: '600519.SH' }, fields: 'ts_code,pe',
  })

  // Tushare-level failure (e.g. 积分不足) must throw, not return rows.
  globalThis.fetch = async () => new Response(JSON.stringify({ code: 40203, msg: '积分不足' }))
  await assert.rejects(
    () => tushareQuery({ endpoint: 'https://example.test', token: 'tok', apiName: 'daily_basic' }),
    /积分不足/,
  )
})
