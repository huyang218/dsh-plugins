/**
 * seal — put a company seal on a PDF.
 *
 * Two shapes of stamp, because Chinese contract practice uses both:
 *
 *   **合同章** — the seal on the signature block of one or more pages.
 *   **骑缝章** — one seal divided across the edges of every page in a group, so
 *   that a page removed, inserted or swapped leaves a visible gap in it.
 *
 * What this is NOT, stated here because it is the thing people assume: drawing
 * a seal image on a page is not a signature. It carries no identity, and it
 * does not detect a later edit — anyone holding the file can lift the image and
 * put it on another document. Under 《电子签名法》 a reliable electronic
 * signature needs a certificate that binds the signer and a cryptographic
 * signature over the document's bytes. This plugin renders the seal that people
 * expect to see; when the document has to hold up, that has to be signed too.
 *
 * @module dsh-plugin-seal
 */

import { readFile, writeFile } from 'node:fs/promises'
import Schema from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { anchorNames, selectPages } from './geometry.js'
import { embedSeal, loadPdf, save, stampPages, stampStraddle } from './pdf.js'
import { createSelfSigned, DEFAULT_DAYS } from './certificate.js'
import { describeCertificate, describeSignature, hasSignature, signPdf, signerFailureMessage } from './sign.js'

/** Cordis plugin name used by loader diagnostics. */
const name = 'seal'

/** Services required before `apply` runs. */
const inject = ['tools', 'fs', 'systemPrompt']

const Config = Schema.object({
  sealPath: Schema.string().default('').description(
    '默认印章图片路径(**PNG,带透明背景**)。留空则每次调用都要显式给出 seal_path。'
    + 'JPEG 没有透明通道,盖上去是一个白底红圈,会盖住下面的条款——工具会为此发出警告。',
  ),
  widthMm: Schema.number().default(40).description(
    '印章默认直径(毫米)。国内公章常见 40mm,部分单位 45mm;圆形章按图片比例保持不变形。',
  ),
  opacity: Schema.number().default(0.9).description(
    '不透明度。真实印泥会透出下面的文字,1 是完全不透明。',
  ),
  marginMm: Schema.number().default(20).description(
    '用命名位置(如 bottom-right)时,距页边的距离(毫米)。',
  ),
  maxPagesPerSeal: Schema.number().default(20).description(
    '一枚骑缝章最多跨多少页。60 页的合同盖一枚章,每页只有不到 1 毫米宽的一条,'
    + '看不出也证明不了什么;线下做法同样是分批盖,这个值就是那个批量。',
  ),
  p12Path: Schema.string().default('').description(
    '默认签名证书(PKCS#12,`.p12` / `.pfx`)的路径。配了它,`seal_sign` 就不必每次传 p12_path。'
    + '这里只是**路径**,私钥仍然只在那个文件里。',
  ),
  passphraseEnv: Schema.string().default('').description(
    '存放证书口令的**环境变量名**(如 `SEAL_P12_PASSPHRASE`)。**推荐用这个而不是下面那个**:'
    + 'profile 的配置文件会被备份、同步、截图,而环境变量不会跟着它走。',
  ),
  passphrase: Schema.string().role('secret').default('').description(
    '证书口令,直接写在这里。**它会以明文存进 profile 的 `cordis.patch.yml`**——那个文件没有加密,'
    + '也不会在界面里被打码。谁读到「这个文件 + 那个 .p12」,谁就能以你的名义签署。图省事可以用,'
    + '但 `passphraseEnv` 是更好的选择。',
  ),
  overwrite: Schema.boolean().default(false).description(
    '允许把结果写回原文件。**默认关闭**:盖过章的 PDF 覆盖掉未盖章的原件,是不可逆的。',
  ),
})

/** The paragraph the model gets before it can call either tool. */
const CAPABILITY = [
  'PDF sealing and signing. Three tools, and the difference between them decides what the document',
  'is worth:',
  '',
  '  `seal_stamp` draws a seal image on chosen pages (合同章).',
  '  `seal_straddle` divides one seal across the page edges of a group (骑缝章), so a removed or',
  '  swapped page leaves a gap.',
  '  `seal_sign` adds a PAdES digital signature: a CMS signature over the whole file, from the',
  '  user\'s PKCS#12 certificate.',
  '',
  'The two stamps RENDER AN IMAGE. That is not a signature: it binds no identity and detects no',
  'later edit — anyone with the file can copy the image onto another document. Only `seal_sign`',
  'makes the document verifiable, and only 《电子签名法》-grade when the certificate comes from a CA',
  'the other side trusts. A self-signed certificate produces a valid signature by an unidentified',
  'party; say so rather than calling it signed.',
  '',
  'ORDER MATTERS, and getting it wrong is silent: stamp first, sign last. A signature covers the',
  'bytes that existed when it was made, so stamping a signed file makes every viewer report the',
  'document as modified. If the user asks to stamp something already signed, say that it will break',
  'the signature and offer to stamp the unsigned original and sign again.',
  '',
  'Only ONE signature can be added this way. A second signature rewrites the file and invalidates',
  'the first, so counter-signing by another party needs a tool that appends an incremental update.',
  '',
  'The seal image is supplied by the user. `seal_cert` can issue a SELF-SIGNED certificate for free',
  'when the user has none: that signs validly but proves no identity on its own, so the other side',
  'has to be given the .cer file and choose to trust it. Say that plainly rather than presenting a',
  'self-signed certificate as equivalent to one from a CA.',
].join('\n')

/**
 * Read a file through the sandboxed filesystem, so path policy applies.
 * @param {Object} ctx - the plugin context.
 * @param {string} path - the requested path.
 * @param {Object} exec - the tool execution, for cwd and cancellation.
 * @returns {Promise<Object>} `{ target, bytes }`
 */
async function readThroughFs(ctx, path, exec) {
  const cwd = exec.agent?.session.header.cwd
  const target = await ctx.fs.resolve(path, { ...cwd !== undefined ? { cwd } : {}, signal: exec.signal })
  const info = await ctx.fs.stat(target, exec.signal)
  if (info === undefined) throw new Error(`seal: "${target.displayPath}" not found`)
  if (info.type !== 'file') throw new Error(`seal: "${target.displayPath}" is not a file`)
  return { target, bytes: await readFile(target.path ?? target.displayPath) }
}

/**
 * Decide where the stamped file goes, refusing to overwrite unless allowed.
 * @param {Object} options - `{ input, requested, overwrite }`.
 * @returns {string} the path to write
 */
export function outputPathFor({ input, requested, overwrite }) {
  if (requested !== undefined && requested.trim().length > 0) return requested.trim()
  if (overwrite) return input
  // A sealed contract next to its unsealed original, rather than in place of
  // it: the stamp is not reversible and the original is the thing you compare
  // against if a dispute starts.
  return input.replace(/(\.pdf)?$/i, '') + '.sealed.pdf'
}

/**
 * Work out which certificate and passphrase a signing call should use.
 *
 * Three sources, most specific first: what the call passed, then an environment
 * variable named by the config, then the config's own plaintext field. The
 * environment variable exists because a passphrase in `cordis.patch.yml` is a
 * passphrase in every backup and screenshot of that file — it is supported
 * because it is convenient, and named as the weaker option because it is.
 *
 * @param {Object} options - `{ config, args, env }`.
 * @returns {Object} `{ p12Path, passphrase, passphraseFrom }`
 */
export function resolveCredential({ config, args, env = process.env }) {
  const p12Path = (args.p12_path ?? '').trim() || config.p12Path.trim()
  if (p12Path.length === 0) {
    throw new Error('seal: no certificate. Pass p12_path, or set p12Path in the plugin settings. Use seal_cert to make one if you have none.')
  }

  if (typeof args.passphrase === 'string' && args.passphrase.length > 0) {
    return { p12Path, passphrase: args.passphrase, passphraseFrom: 'argument' }
  }
  const variable = config.passphraseEnv.trim()
  if (variable.length > 0) {
    const fromEnv = env[variable]
    if (typeof fromEnv === 'string' && fromEnv.length > 0) {
      return { p12Path, passphrase: fromEnv, passphraseFrom: `\$${variable}` }
    }
    // Named but unset is a mistake worth reporting: falling back to the
    // plaintext field would quietly use a different credential than intended.
    throw new Error(`seal: passphraseEnv names ${variable}, but that environment variable is empty or unset in the dsh process.`)
  }
  if (config.passphrase.length > 0) {
    return { p12Path, passphrase: config.passphrase, passphraseFrom: 'settings' }
  }
  return { p12Path, passphrase: '', passphraseFrom: 'none' }
}

/**
 * Whether a page is A4, within a millimetre.
 *
 * Flagged in the summary because the commonest "the seal came out wrong" is a
 * page that is not the size the person assumed — a 40mm seal is correct on A4
 * and a speck on a page twice that wide, and the coordinates alone look fine.
 *
 * @param {number[]} pageMm - `[width, height]` in millimetres.
 * @returns {boolean} whether it is A4
 */
export function isA4(pageMm = []) {
  const [width, height] = pageMm
  return Math.abs(width - 210) <= 1 && Math.abs(height - 297) <= 1
}

/**
 * Refuse to stamp a document that is already signed.
 *
 * Stamping rewrites the file, and the signature then covers bytes that no
 * longer exist — every viewer reports the document as modified, and the party
 * who signed it gets blamed for a change they did not make. The fix is to stamp
 * the unsigned original and sign again, which the message says.
 *
 * @param {Uint8Array} bytes - the document about to be stamped.
 */
export function refuseIfSigned(bytes) {
  if (!hasSignature(bytes)) return
  throw new Error('seal: this PDF is already signed, and stamping it would invalidate that signature — every viewer would report the document as modified. Stamp the unsigned original instead, then sign the result.')
}

/**
 * Register the three tools.
 * @param {Object} ctx - the plugin context.
 * @param {Object} config - the validated configuration.
 */
function apply(ctx, config) {
  ctx.systemPrompt.section({ name: 'seal:capability', text: CAPABILITY })

  if (config.passphrase.length > 0 && config.passphraseEnv.trim().length === 0) {
    // Said once, at startup, because the file it lands in is easy to forget
    // about: profile config gets backed up, synced and pasted into issues.
    ctx.logger?.warn?.('[seal] the signing passphrase is stored in plaintext in this profile\'s cordis.patch.yml; passphraseEnv keeps it out of that file')
  }

  /**
   * Resolve and embed the seal image for one call.
   * @param {Object} pdf - the loaded document.
   * @param {string|undefined} requested - the seal path from the arguments.
   * @param {Object} exec - the tool execution.
   * @returns {Promise<Object>} the embedded seal
   */
  const sealFor = async (pdf, requested, exec) => {
    const path = (requested ?? '').trim() || config.sealPath
    if (path.length === 0) {
      throw new Error('seal: no seal image. Pass seal_path, or set sealPath in the plugin settings. The seal is your own — this plugin does not draw one.')
    }
    const { target, bytes } = await readThroughFs(ctx, path, exec)
    return { ...await embedSeal(pdf, bytes, target.displayPath), path: target.displayPath }
  }

  const sharedOutput = {
    type: 'object',
    additionalProperties: false,
    properties: {
      output: { type: 'string' },
      pdf: { type: 'string' },
      seal: { type: 'string' },
      pages: { type: 'number' },
      widthMm: { type: 'number' },
      heightMm: { type: 'number' },
      notes: { type: 'array', items: { type: 'string' } },
    },
  }

  ctx.tools.register(defineTool({
    name: 'seal_stamp',
    description:
      'Stamp a seal image (合同章) onto chosen pages of a PDF and write a new file. '
      + 'Pages are given as "3", "1,4", "2-5", "all", "first" or "last". Position is a named anchor '
      + '(' + anchorNames().join(', ') + ') with a margin, or explicit x/y in millimetres from the '
      + 'bottom-left. RENDERS an image only: this is not an electronic signature and proves nothing '
      + 'about who sealed it or whether the document changed afterwards.',
    parameters: {
      pdf_path: { type: 'string', required: true, description: 'The PDF to stamp.' },
      pages: { type: 'string', description: 'Which pages: "3", "1,4", "2-5", "all", "first", "last". Default "last".' },
      seal_path: { type: 'string', description: 'The seal image (PNG with transparency). Defaults to the configured one.' },
      anchor: { type: 'string', description: `Where on the page: ${anchorNames().join(', ')}. Default bottom-right.` },
      margin_mm: { type: 'number', description: 'Distance from the anchored edges, in millimetres.' },
      x_mm: { type: 'number', description: 'Explicit position from the left edge; overrides anchor when given with y_mm.' },
      y_mm: { type: 'number', description: 'Explicit position from the bottom edge.' },
      width_mm: { type: 'number', description: 'Seal diameter in millimetres. Defaults to the configured size.' },
      rotation: { type: 'number', description: 'Degrees anticlockwise. Real seals are rarely applied perfectly straight.' },
      opacity: { type: 'number', description: '0 to 1. Defaults to the configured value.' },
      output_path: { type: 'string', description: 'Where to write. Defaults to <input>.sealed.pdf.' },
    },
    output: {
      schema: {
        ...sharedOutput,
        properties: {
          ...sharedOutput.properties,
          stamped: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                page: { type: 'number' },
                xMm: { type: 'number' },
                yMm: { type: 'number' },
                pageMm: { type: 'array', items: { type: 'number' } },
                overflows: { type: 'array', items: { type: 'string' } },
              },
            },
          },
        },
      },
      render: (_args, value) => {
        const lines = [
          `已盖章:${value.output}`,
          `印章 ${value.seal}(${value.widthMm}×${value.heightMm}mm),共 ${value.stamped.length} 处`,
          ...value.stamped.map(one => `  第 ${one.page} 页 @ (${one.xMm}, ${one.yMm})mm`
            + (isA4(one.pageMm) ? '' : ` — 页面 ${one.pageMm[0]}×${one.pageMm[1]}mm,不是 A4`)
            + (one.overflows ? ` — 超出页面 ${one.overflows.join('、')} 边` : '')),
          ...value.notes,
        ]
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    timeoutMs: 120000,
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const { target: pdfTarget, bytes } = await readThroughFs(ctx, args.pdf_path, exec)
      refuseIfSigned(bytes)
      const pdf = await loadPdf(bytes)
      const seal = await sealFor(pdf, args.seal_path, exec)
      const pages = selectPages(args.pages ?? 'last', pdf.getPageCount())

      const result = await stampPages({
        pdf,
        seal,
        pages,
        anchor: args.anchor ?? 'bottom-right',
        marginMm: args.margin_mm ?? config.marginMm,
        ...args.x_mm !== undefined && args.y_mm !== undefined ? { xMm: args.x_mm, yMm: args.y_mm } : {},
        widthMm: args.width_mm ?? config.widthMm,
        heightMm: 0,
        rotation: args.rotation ?? 0,
        opacity: args.opacity ?? config.opacity,
      })

      const output = outputPathFor({ input: pdfTarget.displayPath, requested: args.output_path, overwrite: config.overwrite })
      await writeFile(output, await save(pdf))

      const notes = []
      if (seal.opaque) notes.push('印章是 JPEG,没有透明通道:它会以白底矩形盖住下面的内容。请改用带透明背景的 PNG。')
      const overflowed = result.stamped.filter(one => one.overflows)
      if (overflowed.length > 0) notes.push(`有 ${overflowed.length} 处超出页面边界,位置未被自动修正——请核对后重盖。`)
      if ((args.rotation ?? 0) !== 0) {
        // The reported coordinate is the anchor, and rotation happens around
        // it — so the ink lands slightly elsewhere, and the overflow check
        // above measured the unrotated box. Better said than discovered on a
        // printed contract.
        notes.push('印章有旋转:报告的坐标是旋转前的锚点,实际落点会绕该点偏移,越界检查也是按未旋转的方框算的。角度大时请看一眼成品。')
      }
      notes.push('这是渲染的印章图片,不是电子签名:它不绑定身份,也不能证明此后文件未被改动。')

      return {
        output,
        pdf: pdfTarget.displayPath,
        seal: seal.path,
        pages: pdf.getPageCount(),
        widthMm: result.widthMm,
        heightMm: result.heightMm,
        stamped: result.stamped,
        notes,
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'seal_straddle',
    description:
      'Apply a straddle seal (骑缝章): one seal divided across the edges of every page, so that '
      + 'laying the pages out reassembles it and a removed, inserted or swapped page leaves a gap. '
      + 'Long documents are split into groups of at most maxPagesPerSeal pages, each getting its own '
      + 'seal, because a seal spread over sixty pages is a hairline per page. RENDERS an image only: '
      + 'it makes tampering visible to a reader, it does not make the document cryptographically verifiable.',
    parameters: {
      pdf_path: { type: 'string', required: true, description: 'The PDF to stamp.' },
      seal_path: { type: 'string', description: 'The seal image (PNG with transparency). Defaults to the configured one.' },
      edge: { type: 'string', description: 'Which edge the seal straddles: right (default), left, top or bottom.' },
      offset_mm: { type: 'number', description: 'Move the seal along that edge from centre, in millimetres.' },
      width_mm: { type: 'number', description: 'Seal diameter in millimetres. Defaults to the configured size.' },
      opacity: { type: 'number', description: '0 to 1. Defaults to the configured value.' },
      pages_per_seal: { type: 'number', description: 'Largest group one seal may span. Defaults to the configured value.' },
      output_path: { type: 'string', description: 'Where to write. Defaults to <input>.sealed.pdf.' },
    },
    output: {
      schema: {
        ...sharedOutput,
        properties: {
          ...sharedOutput.properties,
          edge: { type: 'string' },
          groups: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: { from: { type: 'number' }, to: { type: 'number' }, pages: { type: 'number' } },
            },
          },
          sliceMm: { type: 'number' },
        },
      },
      render: (_args, value) => {
        const lines = [
          `已盖骑缝章:${value.output}`,
          `印章 ${value.seal}(${value.widthMm}×${value.heightMm}mm),沿${value.edge}边,共 ${value.pages} 页`,
          ...value.groups.map(group => `  第 ${group.from}–${group.to} 页为一组,每页 ${value.sliceMm}mm 宽的一条`),
          ...value.notes,
        ]
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    timeoutMs: 120000,
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const { target: pdfTarget, bytes } = await readThroughFs(ctx, args.pdf_path, exec)
      refuseIfSigned(bytes)
      const pdf = await loadPdf(bytes)
      if (pdf.getPageCount() < 2) {
        throw new Error('seal: a straddle seal needs at least two pages — on a single page it is just a seal at the edge.')
      }
      const seal = await sealFor(pdf, args.seal_path, exec)

      const result = await stampStraddle({
        pdf,
        seal,
        edge: args.edge ?? 'right',
        offsetMm: args.offset_mm ?? 0,
        widthMm: args.width_mm ?? config.widthMm,
        heightMm: 0,
        opacity: args.opacity ?? config.opacity,
        maxPerSeal: args.pages_per_seal ?? config.maxPagesPerSeal,
      })

      const output = outputPathFor({ input: pdfTarget.displayPath, requested: args.output_path, overwrite: config.overwrite })
      await writeFile(output, await save(pdf))

      const notes = []
      if (seal.opaque) notes.push('印章是 JPEG,没有透明通道:边缘那一条会是白底。请改用带透明背景的 PNG。')
      if (result.groups.length > 1) {
        notes.push(`共分 ${result.groups.length} 组盖章:一枚骑缝章跨太多页,每页只剩一条细线,看不出也证明不了什么。`)
      }
      notes.push('骑缝章让「抽页、换页」在肉眼下可见,但它不是电子签名,不能证明内容本身未被改动。')

      return {
        output,
        pdf: pdfTarget.displayPath,
        seal: seal.path,
        pages: pdf.getPageCount(),
        edge: args.edge ?? 'right',
        widthMm: result.widthMm,
        heightMm: result.heightMm,
        groups: result.groups,
        sliceMm: result.drawn[0]?.sliceMm ?? 0,
        notes,
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'seal_sign',
    description:
      'Add a PAdES digital signature to a PDF using the user\'s PKCS#12 (.p12/.pfx) certificate. '
      + 'This is the part that makes a document verifiable: the signature covers the whole file, so '
      + 'any later edit — including adding a seal image — is detectable, and the certificate says who '
      + 'signed. Sign LAST, after any stamping. Only one signature can be added this way; a second '
      + 'would invalidate the first. A self-signed certificate yields a valid signature by an '
      + 'unidentified party, which is reported rather than glossed over.',
    parameters: {
      pdf_path: { type: 'string', required: true, description: 'The PDF to sign — already stamped, if it is to be stamped.' },
      p12_path: { type: 'string', description: 'The PKCS#12 bundle holding the private key and its certificate. Defaults to the configured one.' },
      passphrase: { type: 'string', description: 'The passphrase for that bundle. Defaults to the configured environment variable or setting.' },
      reason: { type: 'string', description: 'Why it was signed; shown by PDF viewers.' },
      signer_name: { type: 'string', description: 'The name recorded in the signature dictionary.' },
      location: { type: 'string', description: 'Where it was signed.' },
      contact: { type: 'string', description: 'Contact recorded in the signature.' },
      output_path: { type: 'string', description: 'Where to write. Defaults to <input>.signed.pdf.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          output: { type: 'string' },
          pdf: { type: 'string' },
          coversWholeFile: { type: 'boolean' },
          certificate: {
            type: 'object',
            additionalProperties: false,
            properties: {
              subject: { type: 'string' },
              issuer: { type: 'string' },
              selfSigned: { type: 'boolean' },
              notAfter: { type: 'string' },
              expired: { type: 'boolean' },
            },
          },
          notes: { type: 'array', items: { type: 'string' } },
        },
      },
      render: (_args, value) => {
        const cert = value.certificate
        return [{ type: 'text', text: [
          `已签名:${value.output}`,
          `签署人证书:${cert.subject}`,
          `签发者:${cert.issuer}${cert.selfSigned ? '(自签,不代表任何经核实的身份)' : ''}`,
          `有效期至 ${cert.notAfter}${cert.expired ? '(已过期)' : ''}`,
          value.coversWholeFile ? '签名覆盖整个文件:此后任何改动都会被验签工具发现。' : '⚠ 签名未覆盖整个文件,请勿使用这份结果。',
          ...value.notes,
        ].join('\n') }]
      },
    },
    timeoutMs: 120000,
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const credential = resolveCredential({ config, args })
      const { target: pdfTarget, bytes } = await readThroughFs(ctx, args.pdf_path, exec)
      const { bytes: p12Bytes } = await readThroughFs(ctx, credential.p12Path, exec)

      if (hasSignature(bytes)) {
        // Signing again rewrites the file, and the first signature then reads
        // as broken to every viewer. Refusing beats handing back a document
        // whose existing signature was quietly destroyed.
        throw new Error('seal: this PDF is already signed. Signing it again here rewrites the file and invalidates the existing signature — counter-signing needs a tool that appends an incremental update.')
      }

      let certificate
      try {
        certificate = describeCertificate(p12Bytes, credential.passphrase)
      } catch (error) {
        throw new Error(signerFailureMessage(error))
      }

      const signed = await signPdf({
        pdfBytes: bytes,
        p12Bytes,
        passphrase: credential.passphrase,
        reason: args.reason,
        name: args.signer_name,
        location: args.location,
        contactInfo: args.contact,
      })

      const output = outputPathFor({ input: pdfTarget.displayPath, requested: args.output_path, overwrite: false })
      await writeFile(output, signed)

      const described = describeSignature(signed)
      const notes = []
      if (certificate.selfSigned) {
        notes.push('证书是自签的:签名在密码学上有效,但不证明签署人是谁。要让对方认,需要受信任 CA 签发的证书。')
      }
      if (certificate.expired) notes.push('证书已过期:多数阅读器会对这份签名给出警告。')
      notes.push('此后不要再对这个文件盖章或编辑——那会让签名失效。要盖章就回到未签名的原件,盖完再签。')
      notes.push('可用 pdfsig(poppler)或 Adobe Reader 独立验签,不必信这里的结论。')

      // The source, never the value: knowing which credential was used is
      // what makes a wrong-key failure diagnosable.
      notes.push(`证书 ${credential.p12Path},口令来自${{ argument: '调用参数', settings: '插件设置(明文)', none: '(空)' }[credential.passphraseFrom] ?? `环境变量 ${credential.passphraseFrom}`}。`)

      return {
        output,
        pdf: pdfTarget.displayPath,
        coversWholeFile: described.coversWholeFile === true,
        certificate,
        notes,
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'seal_cert',
    description:
      'Issue a SELF-SIGNED signing certificate and write it as a .p12 bundle plus a .cer public '
      + 'certificate. Free, offline, no CA involved — and that is its limit: the signature it makes '
      + 'is cryptographically valid but identifies nobody by itself. The other party must be given '
      + 'the .cer and choose to trust it, which suits two sides who already know each other. For a '
      + 'signature a stranger will accept, a CA-issued certificate is needed instead. Note that a '
      + 'TLS certificate (Let\'s Encrypt and similar) cannot be used for document signing.',
    parameters: {
      common_name: { type: 'string', required: true, description: 'Who signs — the company or person, as it should be displayed by a PDF reader.' },
      output_path: { type: 'string', required: true, description: 'Where to write the .p12. The .cer is written beside it.' },
      passphrase: { type: 'string', required: true, description: 'Protects the private key in the bundle. Required.' },
      organization: { type: 'string', description: 'Organisation name.' },
      country: { type: 'string', description: 'Two-letter country code, e.g. CN.' },
      email: { type: 'string', description: 'Email address to record.' },
      days: { type: 'number', description: `How long it stays valid. Default ${DEFAULT_DAYS}.` },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          p12: { type: 'string' },
          certificate: { type: 'string' },
          subject: { type: 'string' },
          notAfter: { type: 'string' },
          fingerprint: { type: 'string' },
          notes: { type: 'array', items: { type: 'string' } },
        },
      },
      render: (_args, value) => [{ type: 'text', text: [
        `已签发自签证书:${value.subject}`,
        `私钥包(要保密):${value.p12}`,
        `公钥证书(给对方):${value.certificate}`,
        `有效期至 ${value.notAfter}`,
        `指纹 ${value.fingerprint}`,
        ...value.notes,
      ].join('\n') }],
    },
    timeoutMs: 60000,
    isConcurrencySafe: () => false,
    async execute(args) {
      const made = createSelfSigned({
        commonName: args.common_name,
        organization: args.organization,
        country: args.country,
        email: args.email,
        days: args.days ?? DEFAULT_DAYS,
        passphrase: args.passphrase,
      })

      const p12Path = args.output_path.trim()
      const certPath = p12Path.replace(/(\.p12|\.pfx)?$/i, '') + '.cer'
      // 0o600: the bundle is a private key. A signing key that is world-readable
      // is a signing key anyone on the machine can use as you.
      await writeFile(p12Path, made.p12, { mode: 0o600 })
      await writeFile(certPath, made.certificatePem)

      return {
        p12: p12Path,
        certificate: certPath,
        subject: made.subject,
        notAfter: made.notAfter,
        fingerprint: made.fingerprint,
        notes: [
          '这是自签证书:签名在密码学上有效,但它本身不证明你是谁。要让对方的阅读器认,把 .cer 交给对方并请其信任(核对指纹)。',
          '.p12 里有私钥,谁拿到谁就能以你的名义签署——不要发给任何人,也不要放进代码仓库。已按 0600 权限写入。',
          '需要陌生人或法庭直接采信,得用受信任 CA 签发的证书;TLS 证书(Let\'s Encrypt 之类)不能用于文档签名。',
        ],
      }
    },
  }))
}

export { name, inject, Config, apply }
