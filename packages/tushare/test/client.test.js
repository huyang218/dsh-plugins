import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createQuery, createRateLimiter, rowsToObjects, KIND } from '../lib/client.js'

/** A fetch stub answering with one Tushare body. */
const answering = body => async () => new Response(JSON.stringify(body))

test('rowsToObjects zips the columnar payload and tolerates junk', () => {
  assert.deepEqual(
    rowsToObjects({ fields: ['a', 'b'], items: [[1, 2], [3, null]] }),
    [{ a: 1, b: 2 }, { a: 3, b: null }],
  )
  assert.deepEqual(rowsToObjects(null), [])
  assert.deepEqual(rowsToObjects({}), [])
})

test('query posts the documented request shape and returns rows', async () => {
  const seen = []
  const query = createQuery({
    token: 'tok', endpoint: 'https://x.test',
    fetchImpl: async (url, init) => {
      seen.push({ url, body: JSON.parse(init.body) })
      return new Response(JSON.stringify({ code: 0, data: { fields: ['ts_code'], items: [['600519.SH']] } }))
    },
  })
  assert.deepEqual(await query({ apiName: 'daily', params: { trade_date: '20260814' }, fields: 'ts_code' }),
    [{ ts_code: '600519.SH' }])
  assert.equal(seen[0].url, 'https://x.test')
  assert.deepEqual(seen[0].body, {
    api_name: 'daily', token: 'tok', params: { trade_date: '20260814' }, fields: 'ts_code',
  })
})

test('a missing token fails with an actionable message before any request', async () => {
  const query = createQuery({
    token: '', endpoint: 'https://x.test',
    fetchImpl: async () => assert.fail('must not reach the network without a token'),
  })
  await assert.rejects(() => query({ apiName: 'daily' }), error => {
    assert.equal(error.kind, KIND.NO_TOKEN)
    assert.match(error.message, /未配置|设置/)
    return true
  })
})

test('insufficient points is permanent: no retry, and the agent is told not to improvise', async () => {
  let calls = 0
  const query = createQuery({
    token: 'tok', endpoint: 'https://x.test', retries: 5,
    wait: async () => assert.fail('an access error must not be retried'),
    fetchImpl: async () => {
      calls += 1
      return new Response(JSON.stringify({
        code: 40203, msg: '抱歉，您没有访问该接口的权限，积分要求：2000积分',
      }))
    },
  })
  await assert.rejects(() => query({ apiName: 'moneyflow' }), error => {
    assert.equal(error.kind, KIND.ACCESS)
    assert.equal(error.apiName, 'moneyflow')
    assert.match(error.message, /2000积分/, "Tushare's own requirement must reach the model")
    assert.match(error.message, /不要编造|不要改用/, 'the agent must be told not to fabricate')
    return true
  })
  assert.equal(calls, 1, 'exactly one attempt')
})

test('rate limiting is retried, then surfaces as its own kind', async () => {
  const quota = '抱歉，您访问接口(daily)频率超限(500次/分钟)'
  let calls = 0
  const waited = []
  const query = createQuery({
    token: 'tok', endpoint: 'https://x.test', retries: 2, wait: async ms => waited.push(ms),
    fetchImpl: async () => {
      calls += 1
      return new Response(JSON.stringify(calls < 3
        ? { code: 40203, msg: quota }
        : { code: 0, data: { fields: ['ts_code'], items: [['000001.SZ']] } }))
    },
  })
  assert.deepEqual(await query({ apiName: 'daily' }), [{ ts_code: '000001.SZ' }])
  assert.deepEqual(waited, [3000, 6000], 'backoff grows')

  calls = 0
  const stubborn = createQuery({
    token: 'tok', endpoint: 'https://x.test', retries: 1, wait: async () => {},
    fetchImpl: answering({ code: 40203, msg: quota }),
  })
  await assert.rejects(() => stubborn({ apiName: 'daily' }), error => {
    assert.equal(error.kind, KIND.RATE_LIMIT)
    return true
  })
})

test('other provider errors keep their own kind and wording', async () => {
  const query = createQuery({
    token: 'tok', endpoint: 'https://x.test',
    fetchImpl: answering({ code: 40001, msg: '参数错误' }),
  })
  await assert.rejects(() => query({ apiName: 'daily' }), error => {
    assert.equal(error.kind, KIND.PROVIDER)
    assert.match(error.message, /参数错误/)
    return true
  })
})

test('transport failures are classified, not leaked as raw fetch errors', async () => {
  const query = createQuery({
    token: 'tok', endpoint: 'https://x.test',
    fetchImpl: async () => { throw new TypeError('fetch failed') },
  })
  await assert.rejects(() => query({ apiName: 'daily' }), error => {
    assert.equal(error.kind, KIND.TRANSPORT)
    return true
  })

  const notOk = createQuery({
    token: 'tok', endpoint: 'https://x.test',
    fetchImpl: async () => new Response('nope', { status: 502 }),
  })
  await assert.rejects(() => notOk({ apiName: 'daily' }), /502/)
})

test('the limiter meters per interface and waits out the window', async () => {
  let clock = 1_000_000
  const waited = []
  const acquire = createRateLimiter({
    perMinute: 2, windowMs: 60000, now: () => clock, wait: async ms => { waited.push(ms); clock += ms },
  })
  await acquire('daily')
  await acquire('daily')
  assert.deepEqual(waited, [], 'the first two fit')
  await acquire('daily')
  assert.equal(waited.length, 1, 'the third waits for the oldest to age out')
  await acquire('income')
  assert.equal(waited.length, 1, 'a different interface has its own quota')

  const open = createRateLimiter({ perMinute: 0, wait: async () => assert.fail('must not wait') })
  for (let i = 0; i < 5; i++) await open('daily')
})

test('a rejected token is reported as a token problem, not a generic error', async () => {
  // Observed from the real API: Tushare answers a wrong token with
  // "您的token不对，请确认。" — permanent, and only the user can fix it.
  const query = createQuery({
    token: 'bad', endpoint: 'https://x.test',
    fetchImpl: answering({ code: 40001, msg: '您的token不对，请确认。' }),
  })
  await assert.rejects(() => query({ apiName: 'daily' }), error => {
    assert.equal(error.kind, KIND.NO_TOKEN)
    assert.match(error.message, /换成有效的 token/)
    return true
  })
})
