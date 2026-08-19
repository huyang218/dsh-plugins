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
  overwrite: Schema.boolean().default(false).description(
    '允许把结果写回原文件。**默认关闭**:盖过章的 PDF 覆盖掉未盖章的原件,是不可逆的。',
  ),
})

/** The paragraph the model gets before it can call either tool. */
const CAPABILITY = [
  'PDF sealing: `seal_stamp` puts a seal image on chosen pages (合同章); `seal_straddle` divides one',
  'seal across the edges of a group of pages (骑缝章) so a removed or swapped page leaves a gap.',
  '',
  'State this whenever sealing comes up, and never imply otherwise: these tools RENDER a seal image.',
  'That is not an electronic signature. It binds no identity and detects no later edit — anyone with',
  'the file can copy the image onto another document. Under 《电子签名法》 a reliable electronic',
  'signature additionally needs a certificate binding the signer and a cryptographic signature over',
  'the document. If the user needs the document to hold up in a dispute, say that the image alone',
  'will not, and that it has to be signed by a CA-issued certificate as well.',
  '',
  'The seal image is supplied by the user — their own seal, as a PNG with a transparent background.',
  'These tools do not draw or invent a seal for an organisation.',
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
 * Register both tools.
 * @param {Object} ctx - the plugin context.
 * @param {Object} config - the validated configuration.
 */
function apply(ctx, config) {
  ctx.systemPrompt.section({ name: 'seal:capability', text: CAPABILITY })

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
}

export { name, inject, Config, apply }
