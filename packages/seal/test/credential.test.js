import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createStore, publicView, readSubmission } from '../lib/credential.js'
import * as plugin from '../lib/index.js'

test('a submission must name a bundle that can actually sign', () => {
  assert.deepEqual(readSubmission({ p12Path: ' /keys/c.p12 ', passphrase: 'x' }), { p12Path: '/keys/c.p12', passphrase: 'x' })
  assert.throws(() => readSubmission({}), /give the path/)
  // The .cer is the public half. Without this check the failure surfaces as an
  // ASN.1 error about the wrong thing entirely.
  assert.throws(() => readSubmission({ p12Path: '/keys/公司.cer' }), /public half and cannot sign/)
  assert.deepEqual(readSubmission({ p12Path: '/k/c.pfx' }).passphrase, '', 'a bundle with no passphrase is allowed')
})

test('what the client can see never includes the passphrase', () => {
  // A route that returned it would put it in every browser cache and devtools
  // log that opened the settings page.
  const view = publicView({ p12Path: '/keys/c.p12', passphrase: 'secret', updatedAt: 5 })
  assert.deepEqual(Object.keys(view).sort(), ['durable', 'hasPassphrase', 'p12Path', 'updatedAt'])
  assert.equal(view.hasPassphrase, true)
  assert.equal(JSON.stringify(view).includes('secret'), false)

  const empty = publicView(undefined, { durable: false })
  assert.deepEqual(empty, { p12Path: '', hasPassphrase: false, updatedAt: 0, durable: false })
})

test('a store without a backend keeps working, and says it is not durable', async () => {
  const store = createStore(undefined)
  assert.equal(store.durable, false)
  await store.write({ p12Path: '/k/c.p12', passphrase: 'x' })
  assert.equal((await store.read()).p12Path, '/k/c.p12')
  await store.clear()
  assert.equal(await store.read(), undefined)
})

test('a store over a table reads, writes and clears through it', async () => {
  const rows = new Map()
  const store = createStore({
    get: async key => rows.get(key),
    put: async (key, value) => { rows.set(key, value) },
    delete: async key => { rows.delete(key) },
  })

  assert.equal(store.durable, true)
  await store.write({ p12Path: '/k/c.p12', passphrase: 'x' })
  assert.equal(rows.size, 1)
  assert.equal(typeof [...rows.values()][0].updatedAt, 'number')
  await store.clear()
  assert.equal(rows.size, 0)
})

test('a credential set from the client wins over the config file', async () => {
  // It is the one someone set deliberately in the UI, and the only one not
  // sitting in a file that gets synced and shared.
  const config = new plugin.Config({ p12Path: '/config/old.p12', passphrase: 'from-settings' })
  const stored = { p12Path: '/client/new.p12', passphrase: 'from-client' }

  const resolved = plugin.resolveCredential({ config, args: {}, env: {}, stored })
  assert.equal(resolved.p12Path, '/client/new.p12')
  assert.equal(resolved.passphrase, 'from-client')
  assert.equal(resolved.passphraseFrom, 'client')

  // A call still wins over everything.
  const byCall = plugin.resolveCredential({ config, args: { p12_path: '/call/x.p12', passphrase: 'from-call' }, env: {}, stored })
  assert.equal(byCall.passphrase, 'from-call')
  assert.equal(byCall.p12Path, '/call/x.p12')
})

test('with nothing set anywhere, the error names the client first', () => {
  assert.throws(
    () => plugin.resolveCredential({ config: new plugin.Config(), args: {}, env: {}, stored: undefined }),
    /client's Seal settings/,
  )
})
