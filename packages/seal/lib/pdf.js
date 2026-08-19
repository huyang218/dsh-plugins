/**
 * The PDF side: embed a seal image, draw it, and clip it.
 *
 * Written against pdf-lib, which is the one dependency this package carries.
 * Hand-writing a PDF writer to avoid it would trade a well-tested MIT library
 * for a novel one, on documents people sign.
 *
 * @module dsh-plugin-seal/pdf
 */

import {
  PDFDocument, clip, closePath, degrees, endPath, lineTo, moveTo,
  popGraphicsState, pushGraphicsState,
} from 'pdf-lib'
import { anchorPosition, overflowEdges, sealSize, straddleGroups, straddleSlice, toMm } from './geometry.js'

/**
 * Load a PDF, refusing anything that is not one.
 *
 * `ignoreEncryption` is deliberately off: pdf-lib can open an encrypted
 * document but writes it back without its protection, so a "successful" stamp
 * would quietly strip the password from a contract.
 *
 * @param {Uint8Array} bytes - the file's contents.
 * @returns {Promise<Object>} the parsed document
 */
export async function loadPdf(bytes) {
  try {
    return await PDFDocument.load(bytes)
  } catch (error) {
    throw new Error(loadFailureMessage(error))
  }
}

/**
 * Turn a load failure into something the caller can act on.
 *
 * The encrypted case is separated because the fix is different and the risk is
 * specific: pdf-lib will happily open an encrypted document with
 * `ignoreEncryption` and then write it back WITHOUT its protection, so a
 * "successful" stamp would quietly strip the password from a contract. This
 * package never passes that flag, and says why when it refuses.
 *
 * @param {Error} error - what PDFDocument.load threw.
 * @returns {string} the message to surface
 */
export function loadFailureMessage(error) {
  const message = String(error?.message ?? error)
  if (/encrypt/i.test(message)) {
    return 'seal: this PDF is encrypted. Stamping it would write back a copy without that protection, so it is refused — remove the protection first, deliberately.'
  }
  return `seal: could not read the PDF (${message})`
}

/**
 * Embed a seal image, from PNG or JPEG bytes.
 *
 * PNG is what a seal should be: a JPEG cannot carry transparency, so a JPEG
 * seal arrives as a red circle in a white box that hides the text under it.
 * That is a real and common mistake, so it is named rather than tolerated.
 *
 * @param {Object} pdf - the document to embed into.
 * @param {Uint8Array} bytes - the image file's contents.
 * @param {string} path - where it came from, for the error message.
 * @returns {Promise<Object>} `{ image, aspect, kind }`
 */
export async function embedSeal(pdf, bytes, path) {
  const isPng = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8
  if (!isPng && !isJpeg) throw new Error(`seal: "${path}" is not a PNG or JPEG image`)

  const image = isPng ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes)
  return {
    image,
    aspect: image.width / image.height,
    kind: isPng ? 'png' : 'jpeg',
    // A JPEG seal has no transparency, so it will cover whatever it is placed
    // over. The caller reports this rather than the stamp silently hiding a
    // clause.
    opaque: isJpeg,
  }
}

/**
 * Draw a seal at one place on one page.
 * @param {Object} options - `{ page, image, size, position, rotation, opacity }`.
 */
function drawSeal({ page, image, size, position, rotation, opacity }) {
  page.drawImage(image, {
    x: position.x,
    y: position.y,
    width: size.width,
    height: size.height,
    opacity,
    ...rotation ? { rotate: degrees(rotation) } : {},
  })
}

/**
 * Stamp a contract seal on the chosen pages.
 *
 * @param {Object} options - the document, the seal, and where it goes.
 * @returns {Promise<Object>} what was stamped, per page
 */
export async function stampPages({ pdf, seal, pages, anchor, marginMm, xMm, yMm, widthMm, heightMm, rotation, opacity }) {
  const size = sealSize({ widthMm, heightMm, aspect: seal.aspect })
  const stamped = []

  for (const index of pages) {
    const page = pdf.getPage(index)
    const { width, height } = page.getSize()
    // An explicit coordinate wins over an anchor, and is measured from the
    // bottom-left like the rest of PDF space.
    const position = xMm !== undefined && yMm !== undefined
      ? { x: xMm * (72 / 25.4), y: yMm * (72 / 25.4) }
      : anchorPosition({ page: { width, height }, size, anchor, marginMm })

    const overflow = overflowEdges({ page: { width, height }, size, position })
    drawSeal({ page, image: seal.image, size, position, rotation, opacity })
    stamped.push({
      page: index + 1,
      xMm: toMm(position.x),
      yMm: toMm(position.y),
      // The page's own size, because a seal that looks wrong is usually a page
      // that is not the size everyone assumed: a 40mm seal is right on A4 and
      // a speck on a 437mm-wide page, and nothing else in the result says so.
      pageMm: [toMm(width), toMm(height)],
      ...overflow.length > 0 ? { overflows: overflow } : {},
    })
  }

  return { stamped, widthMm: toMm(size.width), heightMm: toMm(size.height) }
}

/**
 * Stamp a straddle seal across the edges of every page group.
 *
 * Each page gets one slice, drawn through a clip window so the rest of the seal
 * is not merely off-page but absent from the content stream — content outside
 * a page box still travels in the file, and a "hidden" seal that a text
 * extractor can recover is not hidden.
 *
 * @param {Object} options - the document, the seal, and the edge to straddle.
 * @returns {Promise<Object>} the groups and the slices drawn
 */
export async function stampStraddle({ pdf, seal, edge, offsetMm, widthMm, heightMm, opacity, maxPerSeal }) {
  const size = sealSize({ widthMm, heightMm, aspect: seal.aspect })
  const groups = straddleGroups(pdf.getPageCount(), maxPerSeal)
  const drawn = []

  for (const group of groups) {
    for (const [index, pageIndex] of group.entries()) {
      const page = pdf.getPage(pageIndex)
      const { width, height } = page.getSize()
      const slice = straddleSlice({
        pageWidth: width,
        pageHeight: height,
        size,
        index,
        count: group.length,
        edge,
        offsetMm,
      })

      // Clip to this page's slice, draw the whole seal shifted so the right
      // part of it lands inside, then restore — anything after this stamp on
      // the same page must not inherit the clip.
      page.pushOperators(
        pushGraphicsState(),
        moveTo(slice.clip.x, slice.clip.y),
        lineTo(slice.clip.x + slice.clip.width, slice.clip.y),
        lineTo(slice.clip.x + slice.clip.width, slice.clip.y + slice.clip.height),
        lineTo(slice.clip.x, slice.clip.y + slice.clip.height),
        closePath(),
        clip(),
        endPath(),
      )
      drawSeal({ page, image: seal.image, size, position: slice.image, rotation: 0, opacity })
      page.pushOperators(popGraphicsState())

      drawn.push({
        page: pageIndex + 1,
        slice: index + 1,
        of: group.length,
        sliceMm: toMm(slice.sliceWidth ?? slice.sliceHeight),
      })
    }
  }

  return {
    groups: groups.map(group => ({ from: group[0] + 1, to: group.at(-1) + 1, pages: group.length })),
    drawn,
    widthMm: toMm(size.width),
    heightMm: toMm(size.height),
  }
}

/**
 * @param {Object} pdf - the document to write.
 * @returns {Promise<Uint8Array>} its bytes
 */
export async function save(pdf) {
  return pdf.save()
}
