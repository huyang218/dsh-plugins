import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decodeImage, decodePng, detectBackground, encodePng, hasTransparency, imageKind, knockOutBackground } from '../lib/image.js'

/**
 * Build an RGBA image from a function, so a case can be described rather than
 * fixtured.
 * @param {number} side - width and height.
 * @param {Function} paint - (x, y) => [r, g, b, a]
 * @returns {Object} `{ width, height, data }`
 */
function draw(side, paint) {
  const data = Buffer.alloc(side * side * 4)
  for (let y = 0; y < side; y += 1) {
    for (let x = 0; x < side; x += 1) {
      const [r, g, b, a] = paint(x, y)
      const at = (y * side + x) * 4
      data[at] = r
      data[at + 1] = g
      data[at + 2] = b
      data[at + 3] = a ?? 255
    }
  }
  return { width: side, height: side, data }
}

/** A disc of ink on a background, the shape every seal has. */
const sealOn = (background, ink) => draw(40, (x, y) =>
  (Math.hypot(x - 20, y - 20) < 14 ? ink : background))

test('an image is recognised by its own bytes', () => {
  assert.equal(imageKind(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), 'png')
  assert.equal(imageKind(new Uint8Array([0xff, 0xd8, 0xff])), 'jpeg')
  assert.equal(imageKind(new Uint8Array([1, 2, 3])), 'unknown')
})

test('a PNG survives encode and decode', () => {
  const original = sealOn([255, 255, 255], [200, 20, 20])
  const decoded = decodePng(encodePng(original))
  assert.equal(decoded.width, 40)
  assert.deepEqual([...decoded.data.subarray(0, 4)], [255, 255, 255, 255])
  // The centre pixel is ink.
  const centre = (20 * 40 + 20) * 4
  assert.deepEqual([...decoded.data.subarray(centre, centre + 3)], [200, 20, 20])
})

test('the background is read off the border, not assumed to be white', () => {
  // This is the case that broke the first version: a real seal arrived on a
  // chroma-key green background, where "background is bright in every channel"
  // keeps the green and removes nothing.
  assert.deepEqual(detectBackground(sealOn([255, 255, 255], [200, 20, 20])), [255, 255, 255])
  assert.deepEqual(detectBackground(sealOn([40, 230, 40], [90, 40, 130])), [40, 230, 40])
  assert.deepEqual(detectBackground(sealOn([200, 200, 200], [10, 10, 10])), [200, 200, 200])
})

test('a green background is removed and purple ink is kept', () => {
  const result = knockOutBackground(sealOn([40, 230, 40], [90, 40, 130]))
  assert.deepEqual(result.background, [40, 230, 40])

  const at = (x, y) => result.image.data[(y * 40 + x) * 4 + 3]
  assert.equal(at(0, 0), 0, 'the corner is background')
  assert.equal(at(20, 20), 255, 'the centre is ink')
  assert.ok(result.ratio > 0.1 && result.ratio < 0.5, `kept ${result.ratio}`)
  assert.equal(result.warning, undefined)
})

test('white paper is removed just as well', () => {
  const result = knockOutBackground(sealOn([255, 255, 255], [200, 20, 20]))
  assert.deepEqual(result.background, [255, 255, 255])
  assert.equal(result.image.data[3], 0)
  assert.equal(result.image.data[(20 * 40 + 20) * 4 + 3], 255)
})

test('a key that kept everything or nothing warns instead of looking fine', () => {
  // Both failures are invisible until the thing is printed on a contract.
  const noBackground = knockOutBackground(draw(20, () => [90, 40, 130]), { tolerance: 5 })
  assert.ok(noBackground.ratio < 0.02 || noBackground.warning !== undefined)

  const busy = knockOutBackground(draw(20, (x, y) => (x + y) % 2 ? [10, 10, 10] : [250, 250, 250]))
  assert.ok(busy.warning === undefined || /背景/.test(busy.warning))
})

test('existing transparency is never undone', () => {
  const alreadyCut = draw(10, (x, y) => (x === 5 ? [200, 20, 20, 255] : [0, 0, 0, 0]))
  assert.equal(hasTransparency(alreadyCut), true)
  const result = knockOutBackground(alreadyCut)
  assert.equal(result.image.data[3], 0, 'a transparent pixel stays transparent')
})

test('ink-only mode is off by default, because seals are not always red', () => {
  // The seal this was built against is purple; a red-only filter erases it.
  const purple = sealOn([255, 255, 255], [90, 40, 130])
  assert.equal(knockOutBackground(purple).image.data[(20 * 40 + 20) * 4 + 3], 255)
  assert.equal(knockOutBackground(purple, { inkOnly: true }).image.data[(20 * 40 + 20) * 4 + 3], 0)
})

test('an image that is not a PNG or JPEG is refused', () => {
  assert.throws(() => decodeImage(new Uint8Array([1, 2, 3, 4])), /must be a PNG or JPEG/)
})
