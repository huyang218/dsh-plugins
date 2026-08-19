import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  PT_PER_MM, anchorNames, anchorPosition, mm, overflowEdges,
  sealSize, selectPages, straddleGroups, straddleSlice, toMm,
} from '../lib/geometry.js'

/** A4 in points, which is what a contract almost always is. */
const A4 = { width: 595.28, height: 841.89 }

test('millimetres convert to points and back', () => {
  assert.equal(Math.round(mm(25.4)), 72, 'an inch is 72 points')
  assert.equal(toMm(mm(40)), 40)
  assert.ok(Math.abs(PT_PER_MM - 2.8346) < 0.001)
})

test('a round seal keeps its proportions from one dimension', () => {
  // Squashing a round seal to fit a box is how you get one that looks forged.
  const round = sealSize({ widthMm: 40, heightMm: 0, aspect: 1 })
  assert.equal(toMm(round.width), 40)
  assert.equal(toMm(round.height), 40)

  const oval = sealSize({ widthMm: 45, heightMm: 0, aspect: 1.5 })
  assert.equal(toMm(oval.width), 45)
  assert.equal(toMm(oval.height), 30, 'the image decides the other side')

  // Both given means both honoured — an oval seal that really is 45×30.
  const explicit = sealSize({ widthMm: 45, heightMm: 30, aspect: 1 })
  assert.deepEqual([toMm(explicit.width), toMm(explicit.height)], [45, 30])
})

test('a seal with no size at all is an error, not a guess', () => {
  assert.throws(() => sealSize({ widthMm: 0, heightMm: 0, aspect: 1 }), /widthMm or heightMm/)
  assert.throws(() => sealSize({ widthMm: 40, heightMm: 0, aspect: 0 }), /no usable dimensions/)
})

test('a margin pushes inwards from whichever edges the anchor names', () => {
  const size = sealSize({ widthMm: 40, heightMm: 0, aspect: 1 })
  const bottomRight = anchorPosition({ page: A4, size, anchor: 'bottom-right', marginMm: 20 })

  // 20mm from the right edge and 20mm from the bottom, which is what someone
  // means when they say "bottom right, 20 millimetres in".
  assert.equal(toMm(A4.width - (bottomRight.x + size.width)), 20)
  assert.equal(toMm(bottomRight.y), 20)

  const topLeft = anchorPosition({ page: A4, size, anchor: 'top-left', marginMm: 15 })
  assert.equal(toMm(topLeft.x), 15)
  assert.equal(toMm(A4.height - (topLeft.y + size.height)), 15)
})

test('a centred anchor ignores the margin on the centred axis', () => {
  const size = sealSize({ widthMm: 40, heightMm: 0, aspect: 1 })
  const centre = anchorPosition({ page: A4, size, anchor: 'center', marginMm: 20 })
  assert.equal(Math.round(centre.x + size.width / 2), Math.round(A4.width / 2))
  assert.equal(Math.round(centre.y + size.height / 2), Math.round(A4.height / 2))
})

test('an unknown anchor names the ones that exist', () => {
  const size = sealSize({ widthMm: 40, heightMm: 0, aspect: 1 })
  assert.throws(
    () => anchorPosition({ page: A4, size, anchor: 'middle-right' }),
    error => error.message.includes('bottom-right') && error.message.includes('middle-right'),
  )
  assert.ok(anchorNames().includes('bottom-right'))
})

test('a seal hanging off the page is reported, not nudged back', () => {
  // Moving it silently puts the seal somewhere the signer did not choose.
  const size = sealSize({ widthMm: 40, heightMm: 0, aspect: 1 })
  assert.deepEqual(overflowEdges({ page: A4, size, position: { x: 100, y: 100 } }), [])
  assert.deepEqual(overflowEdges({ page: A4, size, position: { x: -5, y: 100 } }), ['left'])
  assert.deepEqual(
    overflowEdges({ page: A4, size, position: { x: A4.width - 10, y: A4.height - 10 } }).sort(),
    ['right', 'top'],
  )
})

test('page selectors read the way people write them', () => {
  assert.deepEqual(selectPages('all', 3), [0, 1, 2])
  assert.deepEqual(selectPages('', 3), [0, 1, 2])
  assert.deepEqual(selectPages('last', 3), [2])
  assert.deepEqual(selectPages('first', 3), [0])
  assert.deepEqual(selectPages('2', 3), [1])
  assert.deepEqual(selectPages('1,3', 3), [0, 2])
  assert.deepEqual(selectPages('2-4', 5), [1, 2, 3])
  // A page named twice would be stamped twice, and a seal is semi-transparent,
  // so the double shows.
  assert.deepEqual(selectPages('2,2,2-3', 3), [1, 2])
})

test('a page selector outside the document says how many pages there are', () => {
  assert.throws(() => selectPages('7', 3), /has 3 page\(s\); asked for 7/)
  assert.throws(() => selectPages('x', 3), /not a page number/)
  assert.throws(() => selectPages('5-2', 9), /not a page range/)
})

test('a long document is stamped in groups, not one hairline seal', () => {
  assert.deepEqual(straddleGroups(6, 20), [[0, 1, 2, 3, 4, 5]])
  assert.deepEqual(straddleGroups(5, 2), [[0, 1], [2, 3, 4]], 'a lone trailing page joins the group before it')
  assert.equal(straddleGroups(60, 20).length, 3)
  assert.deepEqual(straddleGroups(0, 20), [])

  // A group of one page cannot straddle anything: its slice is the whole seal,
  // which proves nothing about any other page.
  for (const group of straddleGroups(41, 20)) assert.ok(group.length >= 2)
})

test('straddle slices tile the seal exactly, with no overlap or gap', () => {
  const size = sealSize({ widthMm: 40, heightMm: 0, aspect: 1 })
  const count = 4
  const slices = Array.from({ length: count }, (_, index) => straddleSlice({
    pageWidth: A4.width, pageHeight: A4.height, size, index, count, edge: 'right',
  }))

  // Every page shows the same window at its right edge …
  for (const slice of slices) {
    assert.equal(Math.round(slice.clip.x + slice.clip.width), Math.round(A4.width))
    assert.equal(Math.round(slice.clip.width * count), Math.round(size.width))
  }
  // … and the image steps left by exactly one slice each time, so laying the
  // pages side by side reassembles the seal with nothing repeated or missing.
  for (let index = 1; index < count; index += 1) {
    const step = slices[index - 1].image.x - slices[index].image.x
    assert.ok(Math.abs(step - slices[0].clip.width) < 0.001, `slice ${index} does not abut slice ${index - 1}`)
  }
  // The first page shows the seal's leading edge.
  assert.equal(Math.round(slices[0].image.x), Math.round(A4.width - size.width / count))
})

test('the top edge straddles horizontally instead', () => {
  const size = sealSize({ widthMm: 40, heightMm: 0, aspect: 1 })
  const slice = straddleSlice({ pageWidth: A4.width, pageHeight: A4.height, size, index: 0, count: 3, edge: 'top' })
  assert.equal(Math.round(slice.clip.y + slice.clip.height), Math.round(A4.height))
  assert.equal(Math.round(slice.clip.height * 3), Math.round(size.height))
})

test('a straddle seal refuses the cases that cannot mean anything', () => {
  const size = sealSize({ widthMm: 40, heightMm: 0, aspect: 1 })
  const base = { pageWidth: A4.width, pageHeight: A4.height, size }
  assert.throws(() => straddleSlice({ ...base, index: 0, count: 1 }), /at least two pages/)
  assert.throws(() => straddleSlice({ ...base, index: 3, count: 3 }), /outside a group/)
  assert.throws(() => straddleSlice({ ...base, index: 0, count: 2, edge: 'corner' }), /unknown edge/)
})
