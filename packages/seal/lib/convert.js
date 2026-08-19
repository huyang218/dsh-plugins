/**
 * Turning a Word document into the PDF that will actually be sealed.
 *
 * Contracts arrive as `.docx`, and a seal goes on a PDF. The conversion is a
 * separate, visible step rather than something the stamping tools do quietly,
 * because it is not lossless in the way that matters here: fonts substitute,
 * lines rewrap, pagination moves. After it, **the PDF is the document** — it is
 * what gets stamped, signed and disputed, and it may not lay out exactly like
 * the file the parties edited. Doing that silently inside "stamp this" would
 * hide a change to the thing being signed.
 *
 * LibreOffice does the conversion. It is not bundled: this package ships no
 * binaries, and a converter that silently is not there must say so rather than
 * produce nothing.
 *
 * @module dsh-plugin-seal/convert
 */

import { execFile } from 'node:child_process'
import { access, readdir, rename } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

/** Where LibreOffice usually is, beyond whatever is on PATH. */
const KNOWN_PATHS = [
  '/Applications/LibreOffice.app/Contents/MacOS/soffice',
  '/usr/bin/soffice',
  '/usr/local/bin/soffice',
  '/opt/homebrew/bin/soffice',
  '/snap/bin/libreoffice',
]

/** Formats LibreOffice will take here; anything else is not a document. */
export const CONVERTIBLE = new Set(['.docx', '.doc', '.odt', '.rtf', '.xlsx', '.pptx'])

/**
 * @param {string} path - a file path.
 * @returns {boolean} whether it is already a PDF
 */
export function isPdf(path) {
  return extname(String(path)).toLowerCase() === '.pdf'
}

/**
 * @param {string} path - a file path.
 * @returns {boolean} whether LibreOffice could turn it into a PDF
 */
export function isConvertible(path) {
  return CONVERTIBLE.has(extname(String(path)).toLowerCase())
}

/**
 * Find the LibreOffice binary, preferring an explicit setting.
 *
 * @param {string} [configured] - `sofficePath` from the settings.
 * @returns {Promise<string|undefined>} the path, or undefined when absent
 */
export async function findSoffice(configured) {
  const candidates = [configured, ...KNOWN_PATHS].filter(one => typeof one === 'string' && one.length > 0)
  for (const candidate of candidates) {
    try {
      await access(candidate)
      return candidate
    } catch {
      // try the next one
    }
  }
  try {
    const { stdout } = await run('which', ['soffice'])
    const found = stdout.trim()
    return found.length > 0 ? found : undefined
  } catch {
    return undefined
  }
}

/**
 * What to tell a caller who has no converter.
 * @returns {string} the message
 */
export function missingConverterMessage() {
  return 'seal: no LibreOffice found, so a Word document cannot be turned into a PDF here. '
    + 'Install LibreOffice (brew install --cask libreoffice), or set sofficePath in the plugin settings, '
    + 'or convert the file yourself and pass the PDF.'
}

/**
 * Convert one document to PDF.
 *
 * The output lands beside the input by default, keeping the original: the
 * source document is what the parties edited, and it is what a disagreement
 * about the conversion gets compared against.
 *
 * @param {Object} options - `{ input, output, soffice, timeoutMs }`.
 * @returns {Promise<string>} the path written
 */
export async function toPdf({ input, output, soffice, timeoutMs = 120000 }) {
  const target = output ?? join(dirname(input), `${basename(input, extname(input))}.pdf`)
  const workDir = dirname(target)

  try {
    // LibreOffice names the output itself, from the input's basename, inside
    // --outdir. It also refuses to run twice concurrently against one user
    // profile, which is why the tool that calls this is not concurrency-safe.
    await run(soffice, [
      '--headless',
      '--norestore',
      '--convert-to', 'pdf',
      '--outdir', workDir,
      input,
    ], { timeout: timeoutMs })
  } catch (error) {
    const detail = String(error?.stderr || error?.message || error).trim().slice(0, 300)
    throw new Error(`seal: LibreOffice could not convert "${basename(input)}" (${detail})`)
  }

  const produced = join(workDir, `${basename(input, extname(input))}.pdf`)
  try {
    await access(produced)
  } catch {
    const listing = await readdir(workDir).catch(() => [])
    throw new Error(`seal: LibreOffice reported success but wrote no PDF for "${basename(input)}" (${listing.length} files in the output directory)`)
  }
  if (produced !== target) await rename(produced, target)
  return target
}
