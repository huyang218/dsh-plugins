import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createAccess, createPairing } from '../lib/access.js'

const silent = { info: () => {}, warn: () => {} }

test('a pairing code is six digits and single-use', () => {
  const pairing = createPairing()
  assert.match(pairing.code, /^\d{6}$/)
  assert.equal(pairing.matches(pairing.code), true)
  assert.equal(pairing.matches(` ${pairing.code} `), true, 'a code typed with spaces still pairs')
  assert.equal(pairing.matches(`the code is ${pairing.code}`), false,
    'a message quoting the code is not a pairing attempt')

  pairing.consume()
  // A code that keeps working is a standing key to the machine, and it lives in
  // a log file that gets pasted into issues.
  assert.equal(pairing.matches(pairing.code), false)
  assert.equal(pairing.state(), 'spent')
})

test('a pairing code expires', () => {
  let clock = 0
  const pairing = createPairing({ ttlMs: 1000, now: () => clock })
  assert.equal(pairing.matches(pairing.code), true)
  clock = 1001
  assert.equal(pairing.state(), 'expired')
  assert.equal(pairing.matches(pairing.code), false)
})

test('a configured id is allowed and an unknown one is not', () => {
  const access = createAccess({ configured: ['ou_me'], log: silent })
  assert.equal(access.allows('ou_me'), true)
  assert.equal(access.allows('ou_other'), false)
  assert.equal(access.allows(''), false)
  assert.equal(access.allows(undefined), false)
})

test('pairing is offered only while nobody is authorised', async () => {
  // A bridge that keeps accepting pairings is one that anyone who sees a code
  // in a screenshot can join.
  const withConfigured = createAccess({ configured: ['ou_me'], pairing: createPairing(), log: silent })
  assert.equal(withConfigured.pairingCode(), undefined)

  const open = createAccess({ configured: [], pairing: createPairing(), log: silent })
  assert.match(open.pairingCode(), /^\d{6}$/)
  assert.equal(await open.claim('ou_new', open.pairingCode()), true)
  assert.equal(open.allows('ou_new'), true)
  // Closed now that someone is in.
  assert.equal(open.pairingCode(), undefined)
  assert.equal(await open.claim('ou_second', '123456'), false)
})

test('a wrong code pairs nobody', async () => {
  const access = createAccess({ configured: [], pairing: createPairing(), log: silent })
  assert.equal(await access.claim('ou_guess', '000000'), false)
  assert.equal(access.allows('ou_guess'), false)
  assert.notEqual(access.pairingCode(), undefined, 'a failed guess does not spend the code')
})

test('pairing off means the configured list is the only way in', async () => {
  const access = createAccess({ configured: [], log: silent })
  assert.equal(access.pairingCode(), undefined)
  assert.equal(await access.claim('ou_any', '123456'), false)
  assert.equal(access.anyone(), false)
})

test('a paired sender is persisted and restored after a restart', async () => {
  const rows = new Map()
  const table = {
    put: async (key, value) => { rows.set(key, value) },
    entries: () => rows.entries(),
  }

  const first = createAccess({ configured: [], table, pairing: createPairing(), log: silent })
  await first.claim('ou_phone', first.pairingCode())
  assert.equal(rows.size, 1)

  // A fresh process, same storage: pairing again would be the wrong answer.
  const second = createAccess({ configured: [], table, pairing: createPairing(), log: silent })
  assert.equal(await second.restore(), 1)
  assert.equal(second.allows('ou_phone'), true)
  assert.equal(second.pairingCode(), undefined, 'no new code is offered once someone is paired')
})

test('a storage failure does not lose the pairing for this run', async () => {
  const warnings = []
  const access = createAccess({
    configured: [],
    table: { put: async () => { throw new Error('disk gone') }, entries: () => [] },
    pairing: createPairing(),
    log: { info: () => {}, warn: message => warnings.push(message) },
  })

  assert.equal(await access.claim('ou_phone', access.pairingCode()), true)
  assert.equal(access.allows('ou_phone'), true, 'the phone still works until the process restarts')
  assert.ok(warnings.some(message => message.includes('could not persist')))
})
