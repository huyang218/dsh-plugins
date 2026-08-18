import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as plugin from '../lib/index.js'

// The host half exists only so the loader entry is enabled and the client
// bundle gets served; it still owes the same export shape, because a default
// export would make the Loader drop the namespace.
test('exports the named plugin surface and no default export', () => {
  assert.ok(!('default' in plugin), 'a default export would make the Loader drop the namespace')
  assert.equal(plugin.name, 'astock-chart')
  assert.ok(!plugin.name.startsWith('dsh-plugin-'), 'the package prefix belongs in package.json only')
  assert.equal(typeof plugin.apply, 'function')
})

test('the host half registers nothing', () => {
  // Anything it registered would be invisible to the browser card and would
  // only add startup surface; the client bundle is where the work is.
  const calls = []
  const trap = new Proxy({}, { get: (_t, key) => { calls.push(key); return () => {} } })
  plugin.apply({ tools: trap, systemPrompt: trap, on: () => calls.push('on'), effect: () => calls.push('effect') })
  assert.deepEqual(calls, [])
})
