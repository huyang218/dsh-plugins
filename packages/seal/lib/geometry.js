/**
 * Where a seal goes on a page, in points, computed from millimetres.
 *
 * All of it is pure arithmetic, which is deliberate: placement is the part that
 * is wrong in a way nobody notices until the contract is printed — a seal half
 * off the page, a straddle seal whose slices do not line up when the pages are
 * laid side by side. Arithmetic can be checked without a PDF.
 *
 * PDF user space has its origin at the BOTTOM-left and is measured in points.
 * People describe seals in millimetres from the top or the bottom depending on
 * what they are looking at, so every conversion happens here rather than being
 * repeated at each call site.
 *
 * @module dsh-plugin-seal/geometry
 */

/** Points per millimetre: 72 points to the inch, 25.4 millimetres to the inch. */
export const PT_PER_MM = 72 / 25.4

/**
 * @param {number} mm - a length in millimetres.
 * @returns {number} the same length in PDF points.
 */
export function mm(value) {
  return value * PT_PER_MM
}

/**
 * @param {number} points - a length in points.
 * @returns {number} the same length in millimetres, rounded to 0.1mm.
 */
export function toMm(points) {
  return Math.round((points / PT_PER_MM) * 10) / 10
}

/**
 * The drawn size of a seal, keeping the image's own proportions.
 *
 * A Chinese company seal is round and its diameter is regulated — 40mm for a
 * 公章, 45mm for some official ones — so the caller gives one dimension and
 * the other follows from the image. Squashing a round seal to fit a box is how
 * you get one that looks forged.
 *
 * @param {Object} options - `{ widthMm, heightMm, aspect }`, aspect = w/h.
 * @returns {Object} `{ width, height }` in points
 */
export function sealSize({ widthMm, heightMm, aspect }) {
  if (!(aspect > 0)) throw new Error('seal: the seal image has no usable dimensions')
  if (widthMm > 0 && heightMm > 0) return { width: mm(widthMm), height: mm(heightMm) }
  if (widthMm > 0) return { width: mm(widthMm), height: mm(widthMm) / aspect }
  if (heightMm > 0) return { width: mm(heightMm) * aspect, height: mm(heightMm) }
  throw new Error('seal: give at least one of widthMm or heightMm')
}

/** Named places on a page, as fractions of the page box. */
const ANCHORS = {
  'bottom-right': { x: 1, y: 0, ax: 1, ay: 0 },
  'bottom-left': { x: 0, y: 0, ax: 0, ay: 0 },
  'bottom-center': { x: 0.5, y: 0, ax: 0.5, ay: 0 },
  'top-right': { x: 1, y: 1, ax: 1, ay: 1 },
  'top-left': { x: 0, y: 1, ax: 0, ay: 1 },
  center: { x: 0.5, y: 0.5, ax: 0.5, ay: 0.5 },
}

/** @returns {string[]} the anchor names, for schemas and error messages. */
export function anchorNames() {
  return Object.keys(ANCHORS)
}

/**
 * The bottom-left corner at which to draw a seal.
 *
 * The margin is measured inwards from the named edge, so `bottom-right` with a
 * 20mm margin sits 20mm from both the right edge and the bottom — which is how
 * someone describes it out loud, and not what a raw coordinate would mean.
 *
 * @param {Object} options - `{ page, size, anchor, marginMm }`.
 * @returns {Object} `{ x, y }` in points
 */
export function anchorPosition({ page, size, anchor, marginMm = 20 }) {
  const spot = ANCHORS[anchor]
  if (spot === undefined) throw new Error(`seal: unknown anchor "${anchor}" (use ${anchorNames().join(', ')})`)
  const margin = mm(marginMm)

  // The margin pushes away from whichever edge the anchor names, and does
  // nothing on an axis that is centred.
  const inwardX = spot.ax === 1 ? -margin : spot.ax === 0 ? margin : 0
  const inwardY = spot.ay === 1 ? -margin : spot.ay === 0 ? margin : 0

  return {
    x: page.width * spot.x - size.width * spot.ax + inwardX,
    y: page.height * spot.y - size.height * spot.ay + inwardY,
  }
}

/**
 * Whether a seal at this position is fully on the page.
 *
 * Reported rather than corrected: a seal nudged back onto the page silently is
 * a seal in a place the signer did not choose, and on a contract that matters
 * more than tidiness.
 *
 * @param {Object} options - `{ page, size, position }`.
 * @returns {string[]} the edges it overflows, empty when it fits
 */
export function overflowEdges({ page, size, position }) {
  const edges = []
  if (position.x < 0) edges.push('left')
  if (position.y < 0) edges.push('bottom')
  if (position.x + size.width > page.width) edges.push('right')
  if (position.y + size.height > page.height) edges.push('top')
  return edges
}

/**
 * Split a page count into the groups that each get their own straddle seal.
 *
 * A straddle seal divides one seal across the edges of a group of pages, so a
 * 60-page contract with one seal would give each page a strip under a
 * millimetre wide — visually useless, and useless as evidence. Physical
 * practice is the same: a thick contract is stamped in batches, and the batch
 * size is what `maxPerSeal` names.
 *
 * @param {number} pageCount - pages in the document.
 * @param {number} maxPerSeal - largest group one seal may span.
 * @returns {number[][]} groups of 0-based page indices
 */
export function straddleGroups(pageCount, maxPerSeal = 20) {
  if (!(pageCount > 0)) return []
  const size = Math.max(2, Math.floor(maxPerSeal))
  const groups = []
  for (let start = 0; start < pageCount; start += size) {
    groups.push(Array.from({ length: Math.min(size, pageCount - start) }, (_, index) => start + index))
  }
  // A trailing group of one page cannot straddle anything — one page's strip is
  // the whole seal, which proves nothing. Fold it into the group before it.
  if (groups.length > 1 && groups.at(-1).length === 1) {
    const last = groups.pop()
    groups.at(-1).push(...last)
  }
  return groups
}

/**
 * The clip window and image offset that put slice `index` of a seal at a page's
 * edge.
 *
 * The whole seal is drawn on every page, shifted so that a different slice of
 * it falls inside the clip window each time. Laying the pages out in order —
 * or fanning the printed stack — reassembles the seal, and a page that was
 * removed or swapped leaves a gap in it. Slicing the image itself would need a
 * pixel decoder; moving the window needs arithmetic.
 *
 * @param {Object} options - `{ pageWidth, pageHeight, size, index, count, edge, offsetMm }`.
 * @returns {Object} `{ clip: { x, y, width, height }, image: { x, y } }`
 */
export function straddleSlice({ pageWidth, pageHeight, size, index, count, edge = 'right', offsetMm = 0 }) {
  if (!(count >= 2)) throw new Error('seal: a straddle seal needs at least two pages')
  if (index < 0 || index >= count) throw new Error(`seal: slice ${index} is outside a group of ${count}`)

  if (edge === 'right' || edge === 'left') {
    const sliceWidth = size.width / count
    // Vertically centred by default; the offset moves it up the edge, which is
    // where a signature block usually is.
    const y = (pageHeight - size.height) / 2 + mm(offsetMm)
    const windowX = edge === 'right' ? pageWidth - sliceWidth : 0
    return {
      clip: { x: windowX, y, width: sliceWidth, height: size.height },
      // Put slice `index` inside that window: the image's left edge sits
      // `index` slices to the left of it.
      image: { x: windowX - index * sliceWidth, y },
      sliceWidth,
    }
  }

  if (edge === 'top' || edge === 'bottom') {
    const sliceHeight = size.height / count
    const x = (pageWidth - size.width) / 2 + mm(offsetMm)
    const windowY = edge === 'top' ? pageHeight - sliceHeight : 0
    return {
      clip: { x, y: windowY, width: size.width, height: sliceHeight },
      image: { x, y: windowY - index * sliceHeight },
      sliceHeight,
    }
  }

  throw new Error(`seal: unknown edge "${edge}" (use right, left, top or bottom)`)
}

/**
 * Read a page selector: "1,3,5-7", "all", "last", "first".
 *
 * Returned 0-based and de-duplicated, because a page listed twice would be
 * stamped twice — visibly, since seals are drawn semi-transparent.
 *
 * @param {string} selector - what the caller asked for.
 * @param {number} pageCount - pages in the document.
 * @returns {number[]} 0-based page indices, ascending
 */
export function selectPages(selector, pageCount) {
  const text = String(selector ?? '').trim().toLowerCase()
  if (text.length === 0 || text === 'all') return Array.from({ length: pageCount }, (_, index) => index)
  if (text === 'last') return [pageCount - 1]
  if (text === 'first') return [0]

  const chosen = new Set()
  for (const part of text.split(',')) {
    const piece = part.trim()
    if (piece.length === 0) continue
    const range = /^(\d+)\s*-\s*(\d+)$/.exec(piece)
    if (range !== null) {
      const from = Number(range[1])
      const to = Number(range[2])
      if (from < 1 || to < from) throw new Error(`seal: "${piece}" is not a page range`)
      for (let page = from; page <= to; page += 1) chosen.add(page - 1)
      continue
    }
    if (!/^\d+$/.test(piece)) throw new Error(`seal: "${piece}" is not a page number`)
    chosen.add(Number(piece) - 1)
  }

  const pages = [...chosen].sort((a, b) => a - b)
  const outside = pages.filter(page => page < 0 || page >= pageCount)
  if (outside.length > 0) {
    throw new Error(`seal: the document has ${pageCount} page(s); asked for ${outside.map(page => page + 1).join(', ')}`)
  }
  return pages
}
