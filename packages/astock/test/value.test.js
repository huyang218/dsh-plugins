import { test } from 'node:test'
import assert from 'node:assert/strict'
import { finiteNumber, assignFinite } from '../lib/value.js'

test('finiteNumber rejects every way a provider spells "absent"', () => {
  // Number(null) is 0 and Number('') is 0: coercing blindly would report a
  // missing P/E as a P/E of zero.
  for (const absent of [null, undefined, '', '-']) {
    assert.equal(finiteNumber(absent), undefined, `${JSON.stringify(absent)} must be absent`)
  }
  assert.equal(finiteNumber(NaN), undefined)
  assert.equal(finiteNumber(Infinity), undefined)
})

test('finiteNumber passes real numbers through and normalizes -0', () => {
  assert.equal(finiteNumber(0), 0)
  assert.equal(finiteNumber('11.44'), 11.44)
  assert.equal(finiteNumber(-3.5), -3.5)
  assert.ok(Object.is(finiteNumber(-0), 0), '-0 is not lossless JSON')
})

test('assignFinite only adds keys that carry a usable number', () => {
  const target = assignFinite({ code: '000001' }, { price: 11.5, pe: null, pb: '-', vol: 0 })
  assert.deepEqual(target, { code: '000001', price: 11.5, vol: 0 })
  assert.ok(!('pe' in target))
  assert.ok(!('pb' in target))
})
