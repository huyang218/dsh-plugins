/**
 * Knocking the paper out from behind a seal.
 *
 * A real seal arrives as a photo or scan: red ink on white paper, usually
 * JPEG, always opaque. Stamped as-is it puts a white card over the clause
 * underneath — which is why `embedSeal` warns about it. This turns that image
 * into one with a transparent background, so the ink sits on the page the way
 * ink does.
 *
 * The background colour is **detected, not assumed**. An earlier version keyed
 * on "bright in every channel", which handles a white scan and fails
 * completely on the seal images people actually have: a real one turned up on
 * a chroma-key green background, where that rule keeps the green and throws
 * away nothing. So the border of the image is sampled, the dominant colour
 * there is taken as the background, and pixels are made transparent by how far
 * they sit from it. White paper, green screen and a grey scan all work, and the
 * ink can be any colour — the seal that prompted this is purple.
 *
 * Nothing here tries to detect a circle or "the seal" itself: a shape detector
 * that guesses wrong crops a company's seal, and the caller cannot see that it
 * happened.
 *
 * PNG is decoded and encoded here with zlib, which Node has. JPEG needs a
 * decoder, which is the one thing this file takes a dependency for.
 *
 * @module dsh-plugin-seal/image
 */

import { deflateSync, inflateSync } from 'node:zlib'
import jpeg from 'jpeg-js'

/** PNG's own signature, which is also how the format is recognised. */
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

/**
 * @param {Uint8Array} bytes - a file's contents.
 * @returns {string} 'png', 'jpeg', or 'unknown'
 */
export function imageKind(bytes) {
  if (PNG_MAGIC.every((byte, index) => bytes[index] === byte)) return 'png'
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'jpeg'
  return 'unknown'
}

/** CRC-32, as PNG chunks require. */
function crc32(buffer) {
  let value = 0xffffffff
  for (const byte of buffer) {
    value ^= byte
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1
  }
  return (value ^ 0xffffffff) >>> 0
}

/**
 * Decode a PNG into RGBA pixels.
 *
 * Supports the colour types a seal actually arrives in — greyscale, RGB,
 * greyscale+alpha, RGBA — at 8 bits. Palette and 16-bit images are refused by
 * name rather than decoded into something subtly wrong.
 *
 * @param {Uint8Array} bytes - the PNG.
 * @returns {Object} `{ width, height, data }` with RGBA bytes
 */
export function decodePng(bytes) {
  const view = Buffer.from(bytes)
  let offset = 8
  let width = 0
  let height = 0
  let depth = 0
  let colourType = 0
  const parts = []

  while (offset < view.length) {
    const length = view.readUInt32BE(offset)
    const type = view.toString('latin1', offset + 4, offset + 8)
    const body = view.subarray(offset + 8, offset + 8 + length)
    if (type === 'IHDR') {
      width = body.readUInt32BE(0)
      height = body.readUInt32BE(4)
      depth = body[8]
      colourType = body[9]
      if (body[12] !== 0) throw new Error('seal: interlaced PNGs are not supported — re-save the seal without interlacing')
    } else if (type === 'IDAT') {
      parts.push(body)
    } else if (type === 'IEND') {
      break
    }
    offset += 12 + length
  }

  if (depth !== 8) throw new Error(`seal: this PNG is ${depth}-bit; only 8-bit channels are supported`)
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colourType]
  if (channels === undefined) {
    throw new Error('seal: palette PNGs are not supported — re-save the seal as RGB or RGBA')
  }

  const raw = inflateSync(Buffer.concat(parts))
  const stride = width * channels
  const data = Buffer.alloc(width * height * 4)
  let previous = Buffer.alloc(stride)
  let cursor = 0

  for (let y = 0; y < height; y += 1) {
    const filter = raw[cursor]
    const line = Buffer.from(raw.subarray(cursor + 1, cursor + 1 + stride))
    cursor += 1 + stride

    // Undo the per-row filter. This is the part a decoder cannot skip: the
    // bytes are deltas against the left and upper pixels.
    for (let index = 0; index < stride; index += 1) {
      const left = index >= channels ? line[index - channels] : 0
      const up = previous[index]
      const upLeft = index >= channels ? previous[index - channels] : 0
      if (filter === 1) line[index] = (line[index] + left) & 255
      else if (filter === 2) line[index] = (line[index] + up) & 255
      else if (filter === 3) line[index] = (line[index] + ((left + up) >> 1)) & 255
      else if (filter === 4) {
        const estimate = left + up - upLeft
        const dLeft = Math.abs(estimate - left)
        const dUp = Math.abs(estimate - up)
        const dUpLeft = Math.abs(estimate - upLeft)
        const best = dLeft <= dUp && dLeft <= dUpLeft ? left : dUp <= dUpLeft ? up : upLeft
        line[index] = (line[index] + best) & 255
      }
    }

    for (let x = 0; x < width; x += 1) {
      const from = x * channels
      const to = (y * width + x) * 4
      if (channels === 1) {
        data[to] = data[to + 1] = data[to + 2] = line[from]
        data[to + 3] = 255
      } else if (channels === 2) {
        data[to] = data[to + 1] = data[to + 2] = line[from]
        data[to + 3] = line[from + 1]
      } else {
        data[to] = line[from]
        data[to + 1] = line[from + 1]
        data[to + 2] = line[from + 2]
        data[to + 3] = channels === 4 ? line[from + 3] : 255
      }
    }
    previous = line
  }

  return { width, height, data }
}

/**
 * Encode RGBA pixels as a PNG.
 * @param {Object} image - `{ width, height, data }`.
 * @returns {Uint8Array} the PNG
 */
export function encodePng({ width, height, data }) {
  const raw = Buffer.alloc(height * (width * 4 + 1))
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0 // no filter: seals compress fine and this stays readable
    data.copy
      ? Buffer.from(data).copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4)
      : raw.set(data.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1)
  }

  const chunk = (type, body) => {
    const length = Buffer.alloc(4)
    length.writeUInt32BE(body.length, 0)
    const payload = Buffer.concat([Buffer.from(type, 'latin1'), body])
    const check = Buffer.alloc(4)
    check.writeUInt32BE(crc32(payload), 0)
    return Buffer.concat([length, payload, check])
  }

  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8
  header[9] = 6 // RGBA
  return new Uint8Array(Buffer.concat([
    Buffer.from(PNG_MAGIC),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]))
}

/**
 * Decode any accepted image into RGBA pixels.
 * @param {Uint8Array} bytes - the file.
 * @returns {Object} `{ width, height, data, kind }`
 */
export function decodeImage(bytes) {
  const kind = imageKind(bytes)
  if (kind === 'png') return { ...decodePng(bytes), kind }
  if (kind === 'jpeg') {
    const decoded = jpeg.decode(Buffer.from(bytes), { useTArray: true, formatAsRGBA: true })
    return { width: decoded.width, height: decoded.height, data: Buffer.from(decoded.data), kind }
  }
  throw new Error('seal: the seal image must be a PNG or JPEG')
}

/**
 * Make the paper behind a seal transparent.
 *
 * @param {Object} image - `{ width, height, data }` RGBA.
 * @param {Object} options - `{ threshold, keepColour }`.
 * @returns {Object} `{ image, removed, kept }` — pixel counts, for reporting
 */
export function knockOutBackground({ width, height, data }, { tolerance = 40, softness = 40, background, inkOnly = false } = {}) {
  const paper = background ?? detectBackground({ width, height, data })
  const out = Buffer.from(data)
  let removed = 0
  let kept = 0

  for (let index = 0; index < out.length; index += 4) {
    const red = out[index]
    const green = out[index + 1]
    const blue = out[index + 2]
    const existing = out[index + 3]

    // Distance from the background, per channel. The largest difference is
    // what makes a pixel visibly not-background — averaging would let a strong
    // difference in one channel disappear behind two small ones.
    const distance = Math.max(
      Math.abs(red - paper[0]),
      Math.abs(green - paper[1]),
      Math.abs(blue - paper[2]),
    )

    // A ramp rather than a cut: a hard threshold leaves the jagged edge that
    // makes a stamped seal look pasted on.
    let alpha = distance <= tolerance
      ? 0
      : distance >= tolerance + softness
        ? 255
        : Math.round(((distance - tolerance) / softness) * 255)

    // `inkOnly` keeps only reddish pixels, for a scan with printed text behind
    // the seal. Off by default, and it must stay off: the seal that prompted
    // this work is purple, and a red-only filter would have erased it.
    if (inkOnly && red <= Math.max(green, blue) + 20) alpha = 0

    // Existing transparency is never undone.
    out[index + 3] = existing === 0 ? 0 : Math.min(alpha, existing)
    if (out[index + 3] === 0) removed += 1
    else kept += 1
  }

  const ratio = kept / (removed + kept)
  return {
    image: { width, height, data: out },
    background: paper,
    removed,
    kept,
    ratio,
    // A result that kept nearly everything or nearly nothing is a failed key,
    // and it is invisible until the thing is printed on a contract.
    warning: ratio > 0.9
      ? '几乎没有像素被判为背景:背景可能不是纯色,或容差太小——请看一眼结果再用。'
      : ratio < 0.02
        ? '几乎所有像素都被判为背景:印章可能被整个抠掉了——请看一眼结果再用。'
        : undefined,
  }
}

/**
 * Work out the background colour from the image's own border.
 *
 * The outermost ring is background in every seal image worth stamping: a scan
 * has paper there, a cut-out has its matte there. The mode is taken rather than
 * the mean, because averaging a green screen with a stray dark pixel gives a
 * colour that is neither.
 *
 * @param {Object} image - `{ width, height, data }` RGBA.
 * @param {number} [ring] - how many pixels deep to sample.
 * @returns {number[]} `[r, g, b]`
 */
export function detectBackground({ width, height, data }, ring = 2) {
  const counts = new Map()
  const consider = (x, y) => {
    const at = (y * width + x) * 4
    if (data[at + 3] === 0) return // already transparent: not evidence of a colour
    // Quantised to 16 levels per channel so anti-aliasing and JPEG noise do not
    // split one background into a thousand near-identical colours.
    const key = ((data[at] >> 4) << 8) | ((data[at + 1] >> 4) << 4) | (data[at + 2] >> 4)
    const seen = counts.get(key) ?? { count: 0, red: 0, green: 0, blue: 0 }
    seen.count += 1
    seen.red += data[at]
    seen.green += data[at + 1]
    seen.blue += data[at + 2]
    counts.set(key, seen)
  }

  for (let depth = 0; depth < ring; depth += 1) {
    for (let x = 0; x < width; x += 1) {
      consider(x, depth)
      consider(x, height - 1 - depth)
    }
    for (let y = 0; y < height; y += 1) {
      consider(depth, y)
      consider(width - 1 - depth, y)
    }
  }

  let best
  for (const seen of counts.values()) {
    if (best === undefined || seen.count > best.count) best = seen
  }
  if (best === undefined) return [255, 255, 255]
  return [
    Math.round(best.red / best.count),
    Math.round(best.green / best.count),
    Math.round(best.blue / best.count),
  ]
}

/**
 * Whether an image has any transparency at all.
 *
 * Used to decide whether a seal still needs its background knocked out, and to
 * refuse to report success when the result would be a solid rectangle.
 *
 * @param {Object} image - `{ data }` RGBA.
 * @returns {boolean} whether any pixel is not fully opaque
 */
export function hasTransparency({ data }) {
  for (let index = 3; index < data.length; index += 4) {
    if (data[index] !== 255) return true
  }
  return false
}
