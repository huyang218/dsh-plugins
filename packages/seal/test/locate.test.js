import { test } from 'node:test'
import assert from 'node:assert/strict'
import { findSealSpots, parseBoxes, placementFor, SEAL_MARKERS } from '../lib/locate.js'

/** pdftotext -bbox output, in the shape poppler actually emits. */
const XML = `<doc>
<page width="595.28" height="841.89">
  <word xMin="132.10" yMin="516.07" xMax="402.10" yMax="529.45">甲方采用预付费方式支付服务款项</word>
</page>
<page width="595.28" height="841.89">
  <word xMin="96.00" yMin="717.00" xMax="202.00" yMax="731.00">甲方(盖章)：【Linkspire</word>
  <word xMin="303.00" yMin="717.00" xMax="360.00" yMax="731.00">乙方(盖章)：</word>
  <word xMin="96.00" yMin="741.00" xMax="241.00" yMax="754.00">甲方法人或授权代表签字：henry</word>
</page>
</doc>`

test('words and page sizes are read out of the bbox output', () => {
  const pages = parseBoxes(XML)
  assert.equal(pages.length, 2)
  assert.equal(pages[0].width, 595.28)
  assert.equal(pages[1].words.length, 3)
  assert.equal(pages[1].words[0].text, '甲方(盖章)：【Linkspire')
  assert.equal(pages[1].words[0].yMin, 717)
})

test('XML entities in a signature line do not break the match', () => {
  const [page] = parseBoxes('<page width="10" height="10"><word xMin="1" yMin="1" xMax="2" yMax="2">A&amp;B(盖章)</word></page>')
  assert.equal(page.words[0].text, 'A&B(盖章)')
})

test('the signature block wins over body text that merely says 甲方', () => {
  // A contract says 甲方 throughout and signs once, at the end. A fixed corner
  // — or the first match — lands in the wrong place.
  const best = findSealSpots(parseBoxes(XML))[0]
  assert.equal(best.page, 2)
  assert.match(best.text, /盖章/)
  assert.equal(best.marker, 'seal')
})

test('asking for one party never lands on the other party\'s line', () => {
  const spots = findSealSpots(parseBoxes(XML), { party: '甲方' })
  assert.match(spots[0].text, /甲方\(盖章\)/)
  assert.equal(spots.some(spot => spot.text.includes('乙方')), false,
    'stamping 甲方\'s seal over 乙方\'s line is worse than not stamping')

  const other = findSealSpots(parseBoxes(XML), { party: '乙方' })
  assert.match(other[0].text, /乙方\(盖章\)/)
})

test('the marker table is ordered by how strongly each word means "seal here"', () => {
  const weights = SEAL_MARKERS.map(marker => marker.weight)
  assert.deepEqual(weights, [...weights].sort((a, b) => b - a))
  assert.equal(SEAL_MARKERS.at(-1).label, 'party', 'a bare 甲方 is the weakest signal')
})

test('a located position is converted from top-left to bottom-left origin', () => {
  // Getting this backwards puts the seal exactly as far from the right place as
  // it should have been close to it, which looks plausible enough to ship.
  const candidate = {
    box: { xMin: 96, yMin: 717, xMax: 202, yMax: 731 },
    pageSize: { width: 595.28, height: 841.89 },
  }
  const size = { width: 113, height: 113 }
  const { x, y } = placementFor({ candidate, size, offsetXMm: 0, offsetYMm: 0 })

  // The label's centre is 724 from the top, so 117.89 from the bottom; the seal
  // is centred on that.
  assert.ok(Math.abs((y + size.height / 2) - (841.89 - 724)) < 0.01)
  assert.ok(Math.abs((x + size.width / 2) - 149) < 0.01)
})

test('a computed position is pulled back onto the page', () => {
  // A person who types a coordinate off the page meant it; a search that
  // computes one did not.
  const candidate = {
    box: { xMin: 560, yMin: 820, xMax: 590, yMax: 835 },
    pageSize: { width: 595.28, height: 841.89 },
  }
  const size = { width: 113, height: 113 }
  const { x, y } = placementFor({ candidate, size })
  assert.ok(x >= 0 && x + size.width <= 595.28, `x ${x}`)
  assert.ok(y >= 0 && y + size.height <= 841.89, `y ${y}`)
})
