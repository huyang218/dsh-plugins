import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deflateSync, inflateSync } from 'node:zlib'
import { PDFDocument, PDFDict, PDFName, PDFRawStream, PDFArray } from 'pdf-lib'
import { embedSeal, loadFailureMessage, loadPdf, save, stampPages, stampStraddle } from '../lib/pdf.js'

/**
 * A real PNG with an alpha channel, built here so the tests need no fixture
 * file and no image library. A seal is a red disc on transparency, which is
 * also the shape that matters: the transparent corners are what let a stamp sit
 * over text.
 * @param {number} side - image size in pixels.
 * @returns {Uint8Array} the PNG bytes
 */
function redSealPng(side = 64) {
  const raw = Buffer.alloc(side * (side * 4 + 1))
  for (let y = 0; y < side; y += 1) {
    const rowStart = y * (side * 4 + 1)
    raw[rowStart] = 0 // filter: none
    for (let x = 0; x < side; x += 1) {
      const distance = Math.hypot(x - side / 2, y - side / 2)
      const inside = distance <= side / 2 - 1
      const at = rowStart + 1 + x * 4
      raw[at] = 200
      raw[at + 1] = 16
      raw[at + 2] = 16
      raw[at + 3] = inside ? 255 : 0
    }
  }

  const chunk = (type, body) => {
    const length = Buffer.alloc(4)
    length.writeUInt32BE(body.length, 0)
    const payload = Buffer.concat([Buffer.from(type, 'latin1'), body])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(payload), 0)
    return Buffer.concat([length, payload, crc])
  }

  const header = Buffer.alloc(13)
  header.writeUInt32BE(side, 0)
  header.writeUInt32BE(side, 4)
  header[8] = 8 // bit depth
  header[9] = 6 // colour type: RGBA
  return new Uint8Array(Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]))
}

/** CRC-32, as PNG chunks require. */
function crc32(buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
  }
  return (crc ^ 0xffffffff) >>> 0
}

/**
 * @param {number} pages - how many A4 pages.
 * @returns {Promise<Uint8Array>} a PDF with that many pages
 */
async function blankPdf(pages) {
  const pdf = await PDFDocument.create()
  for (let index = 0; index < pages; index += 1) pdf.addPage([595.28, 841.89])
  return pdf.save()
}

/**
 * The content stream of one page, decompressed — this is what a PDF reader
 * actually draws, so it is where a claim about drawing can be checked.
 * @param {Object} page - a loaded page.
 * @returns {string} the operators
 */
function contentOf(page) {
  const contents = page.node.Contents()
  const streams = contents instanceof PDFArray
    ? contents.asArray().map(ref => page.node.context.lookup(ref))
    : [contents]
  return streams.map(stream => {
    if (!(stream instanceof PDFRawStream)) return ''
    const bytes = Buffer.from(stream.getContents())
    try {
      return inflateSync(bytes).toString('latin1')
    } catch {
      return bytes.toString('latin1')
    }
  }).join('\n')
}

/** @returns {string[]} the image XObject names a page references */
function imagesOn(page) {
  const resources = page.node.Resources()
  const xobjects = resources?.lookupMaybe(PDFName.of('XObject'), PDFDict)
  if (xobjects === undefined) return []
  return xobjects.keys().map(key => key.asString())
}

/** Stamp a fresh document and hand back the reloaded result. */
async function stamped(runner, { pages = 3 } = {}) {
  const pdf = await loadPdf(await blankPdf(pages))
  const seal = await embedSeal(pdf, redSealPng(), 'seal.png')
  const result = await runner(pdf, seal)
  return { result, output: await PDFDocument.load(await save(pdf)) }
}

test('a PNG seal embeds and reports square proportions', async () => {
  const pdf = await loadPdf(await blankPdf(1))
  const seal = await embedSeal(pdf, redSealPng(), 'seal.png')
  assert.equal(seal.kind, 'png')
  assert.equal(seal.opaque, false)
  assert.equal(Math.round(seal.aspect), 1)
})

test('a file that is not an image is refused by name', async () => {
  const pdf = await loadPdf(await blankPdf(1))
  await assert.rejects(
    embedSeal(pdf, new Uint8Array([1, 2, 3, 4]), 'notes.txt'),
    /"notes.txt" is not a PNG or JPEG/,
  )
})

test('a contract seal lands only on the pages that were asked for', async () => {
  const { result, output } = await stamped(
    (pdf, seal) => stampPages({
      pdf, seal, pages: [0, 2], anchor: 'bottom-right', marginMm: 20, widthMm: 40, heightMm: 0, rotation: 0, opacity: 0.9,
    }),
    { pages: 3 },
  )

  assert.deepEqual(result.stamped.map(one => one.page), [1, 3])
  assert.equal(result.widthMm, 40)
  assert.equal(result.heightMm, 40, 'a round seal stays round')

  // Structural proof, not a claim about the return value: the untouched page
  // references no image at all.
  assert.equal(imagesOn(output.getPage(0)).length, 1)
  assert.equal(imagesOn(output.getPage(1)).length, 0)
  assert.equal(imagesOn(output.getPage(2)).length, 1)
})

test('the seal sits where the anchor and margin say', async () => {
  const { result } = await stamped(
    (pdf, seal) => stampPages({
      pdf, seal, pages: [0], anchor: 'bottom-right', marginMm: 20, widthMm: 40, heightMm: 0, rotation: 0, opacity: 0.9,
    }),
    { pages: 1 },
  )

  // A4 is 210mm wide: 210 - 20 margin - 40 seal = 150mm from the left.
  assert.equal(result.stamped[0].xMm, 150)
  assert.equal(result.stamped[0].yMm, 20)
  assert.equal(result.stamped[0].overflows, undefined)
})

test('a seal placed off the page says so instead of being moved', async () => {
  const { result } = await stamped(
    (pdf, seal) => stampPages({
      pdf, seal, pages: [0], xMm: 190, yMm: 10, widthMm: 40, heightMm: 0, rotation: 0, opacity: 0.9,
    }),
    { pages: 1 },
  )
  assert.deepEqual(result.stamped[0].overflows, ['right'])
  assert.equal(result.stamped[0].xMm, 190, 'the position it was given is the position it got')
})

test('a straddle seal puts one clipped slice on every page', async () => {
  const { result, output } = await stamped(
    (pdf, seal) => stampStraddle({
      pdf, seal, edge: 'right', offsetMm: 0, widthMm: 40, heightMm: 0, opacity: 0.9, maxPerSeal: 20,
    }),
    { pages: 4 },
  )

  assert.deepEqual(result.groups, [{ from: 1, to: 4, pages: 4 }])
  assert.equal(result.drawn.length, 4)
  assert.equal(result.drawn[0].sliceMm, 10, '40mm over four pages is 10mm each')

  for (let index = 0; index < 4; index += 1) {
    const page = output.getPage(index)
    assert.equal(imagesOn(page).length, 1, `page ${index + 1} carries the seal`)
    const content = contentOf(page)
    // W n is the clip: without it the whole seal would be drawn on every page
    // and the straddle would prove nothing.
    assert.match(content, /W\s+n/, `page ${index + 1} has no clipping path`)
    assert.match(content, /\bq\b[\s\S]*\bQ\b/, `page ${index + 1} does not restore its graphics state`)
  }
})

test('the slices step across the seal so the pages reassemble it', async () => {
  const { output } = await stamped(
    (pdf, seal) => stampStraddle({
      pdf, seal, edge: 'right', offsetMm: 0, widthMm: 40, heightMm: 0, opacity: 1, maxPerSeal: 20,
    }),
    { pages: 3 },
  )

  // The image is placed by a cm matrix; the e component is its x offset. Each
  // page must shift it left by exactly one slice, or the printed pages show the
  // same fragment three times.
  const offsets = [0, 1, 2].map(index => {
    const matrix = /([-\d.]+) 0 0 ([-\d.]+) ([-\d.]+) ([-\d.]+) cm/.exec(contentOf(output.getPage(index)))
    assert.ok(matrix, `page ${index + 1} draws no image`)
    return Number(matrix[3])
  })

  const sliceWidth = (40 * 72) / 25.4 / 3
  assert.ok(Math.abs((offsets[0] - offsets[1]) - sliceWidth) < 0.01)
  assert.ok(Math.abs((offsets[1] - offsets[2]) - sliceWidth) < 0.01)
})

test('a long document is stamped in groups', async () => {
  const { result } = await stamped(
    (pdf, seal) => stampStraddle({
      pdf, seal, edge: 'right', offsetMm: 0, widthMm: 40, heightMm: 0, opacity: 0.9, maxPerSeal: 4,
    }),
    { pages: 10 },
  )

  assert.deepEqual(result.groups, [
    { from: 1, to: 4, pages: 4 },
    { from: 5, to: 8, pages: 4 },
    { from: 9, to: 10, pages: 2 },
  ])
  assert.equal(result.drawn.length, 10, 'every page still gets exactly one slice')
})

test('a file that is not a PDF is refused with the reason', async () => {
  await assert.rejects(
    loadPdf(new Uint8Array(Buffer.from('this is a text file'))),
    /could not read the PDF/,
  )
})

test('an encrypted PDF is refused rather than silently unprotected', () => {
  // pdf-lib opens one only with `ignoreEncryption`, and then writes it back
  // WITHOUT the protection — so a "successful" stamp would strip the password
  // from a contract. This package never passes that flag; what is checked here
  // is that the refusal explains the fix rather than reading as a broken file.
  const message = loadFailureMessage(new Error('Input document to `PDFDocument.load` is encrypted.'))
  assert.match(message, /encrypted/)
  assert.match(message, /without that protection/)
  assert.match(loadFailureMessage(new Error('bad xref')), /could not read the PDF \(bad xref\)/)
})
