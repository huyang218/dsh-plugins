/**
 * Finding where the seal belongs, instead of putting it in a corner.
 *
 * A fixed position is wrong on every real contract: the signature block is not
 * always on the last page — on the agreement this was built against it is on
 * page 4 of 5 — and "bottom right" lands in white space while the party's name
 * sits half a page above it. So the words are read out of the PDF with their
 * coordinates, and the seal goes where the document says the seal goes.
 *
 * `pdftotext -bbox` (poppler) does the reading. It is optional: without it the
 * tools still stamp, at an anchor, and say that is what happened rather than
 * pretending they searched.
 *
 * Coordinates need care. pdftotext reports a top-left origin; PDF drawing uses
 * bottom-left. Getting that backwards puts the seal exactly as far from the
 * right place as it should have been close to it, which looks plausible enough
 * to ship.
 *
 * @module dsh-plugin-seal/locate
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)

/**
 * What a signature block says, in the order it is preferred.
 *
 * `盖章` and `签章` name the act directly and are the strongest signal. A bare
 * party marker (`甲方`) is last: it appears throughout the body text too, so it
 * only counts when nothing better was found on that page.
 */
export const SEAL_MARKERS = [
  { pattern: /(盖\s*章|签\s*章|印\s*章|公\s*章|盖章处)/, weight: 100, label: 'seal' },
  { pattern: /(signature|seal|stamp)\s*[:：]?/i, weight: 60, label: 'signature' },
  { pattern: /(签\s*字|签\s*署|署\s*名)/, weight: 40, label: 'sign' },
  { pattern: /(甲\s*方|乙\s*方|丙\s*方|Party\s+[AB])/i, weight: 20, label: 'party' },
]

/**
 * Read every word and its box out of a PDF.
 *
 * @param {Object} options - `{ path, pdftotext, timeoutMs }`.
 * @returns {Promise<Object[]>} one entry per page, with words in top-left coordinates
 */
export async function readWords({ path, pdftotext = 'pdftotext', timeoutMs = 60000 }) {
  let xml
  try {
    const { stdout } = await run(pdftotext, ['-bbox', path, '-'], { timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 })
    xml = stdout
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new Error('seal: pdftotext (poppler) is not installed, so the signature block cannot be located. Install poppler, or give an anchor or explicit coordinates.')
    }
    throw new Error(`seal: reading the document's text failed (${String(error?.message ?? error).slice(0, 200)})`)
  }
  return parseBoxes(xml)
}

/**
 * Parse pdftotext's `-bbox` output.
 *
 * Kept separate from running it so the parsing — the part that silently gets
 * coordinates wrong — can be tested without poppler installed.
 *
 * @param {string} xml - the tool's output.
 * @returns {Object[]} pages of `{ width, height, words }`
 */
export function parseBoxes(xml) {
  const pages = []
  const pagePattern = /<page width="([\d.]+)" height="([\d.]+)">([\s\S]*?)<\/page>/g
  const wordPattern = /<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([\s\S]*?)<\/word>/g

  let pageMatch
  while ((pageMatch = pagePattern.exec(xml)) !== null) {
    const words = []
    let wordMatch
    while ((wordMatch = wordPattern.exec(pageMatch[3])) !== null) {
      words.push({
        xMin: Number(wordMatch[1]),
        yMin: Number(wordMatch[2]),
        xMax: Number(wordMatch[3]),
        yMax: Number(wordMatch[4]),
        // Entities matter: a document with `&amp;` in the signature line would
        // otherwise fail to match its own text.
        text: wordMatch[5]
          .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"').replace(/&apos;/g, "'"),
      })
    }
    pages.push({ width: Number(pageMatch[1]), height: Number(pageMatch[2]), words })
  }
  return pages
}

/**
 * Rank the places a seal could go.
 *
 * Later pages win ties: a contract repeats "甲方" throughout and signs once, at
 * the end. Lower on the page wins within a page, for the same reason.
 *
 * @param {Object[]} pages - from {@link readWords}.
 * @param {Object} [options] - `{ party }` to prefer one side's block.
 * @returns {Object[]} candidates, best first
 */
export function findSealSpots(pages, { party } = {}) {
  const candidates = []

  pages.forEach((page, index) => {
    for (const word of page.words) {
      const marker = SEAL_MARKERS.find(one => one.pattern.test(word.text))
      if (marker === undefined) continue

      let score = marker.weight + index * 5 + (word.yMin / page.height) * 10
      // Asked for one party, a word naming the other is not a candidate at all
      // — stamping 甲方's seal over 乙方's line is worse than not stamping.
      if (party !== undefined && party.length > 0) {
        if (word.text.includes(party)) score += 50
        else if (/甲\s*方|乙\s*方|丙\s*方/.test(word.text)) continue
      }

      candidates.push({
        page: index + 1,
        text: word.text.trim().slice(0, 40),
        marker: marker.label,
        score,
        box: { xMin: word.xMin, yMin: word.yMin, xMax: word.xMax, yMax: word.yMax },
        pageSize: { width: page.width, height: page.height },
      })
    }
  })

  return candidates.sort((a, b) => b.score - a.score)
}

/**
 * Turn a candidate into a bottom-left position for the seal.
 *
 * The seal is centred on the label and pushed slightly down and right, which is
 * where a person puts it: overlapping the party name and the line under it,
 * rather than beside them in the margin. It is then pulled back onto the page
 * if that would hang it over an edge — for a computed position, unlike one a
 * person typed, silently going off-page helps nobody.
 *
 * @param {Object} options - `{ candidate, size, offsetMm }`.
 * @returns {Object} `{ x, y }` in points
 */
export function placementFor({ candidate, size, offsetXMm = 6, offsetYMm = -4 }) {
  const { box, pageSize } = candidate
  const points = value => (value * 72) / 25.4

  const centreX = (box.xMin + box.xMax) / 2 + points(offsetXMm)
  // pdftotext measures from the top; PDF space measures from the bottom.
  const centreYFromTop = (box.yMin + box.yMax) / 2 - points(offsetYMm)
  const centreY = pageSize.height - centreYFromTop

  const x = Math.min(Math.max(centreX - size.width / 2, 0), Math.max(0, pageSize.width - size.width))
  const y = Math.min(Math.max(centreY - size.height / 2, 0), Math.max(0, pageSize.height - size.height))
  return { x, y }
}
