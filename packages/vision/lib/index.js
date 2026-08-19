/**
 * vision — a tool the text-only agent calls mid-task to have a multimodal
 * model look at an image, so the main model never carries image bytes.
 *
 * Vendored from https://github.com/gloryxpnv/dsh-tool-vision (MIT, v0.3.0,
 * commit 35789ca) and adapted to this repository's conventions. The upstream
 * text named LM Studio throughout; the endpoint is any OpenAI-compatible
 * `/chat/completions`, so failures now name the endpoint that was actually
 * called. See README.md for the full list of changes.
 *
 * Two surfaces:
 *  - the model-facing `vision` tool: reads an image file and returns the VLM's
 *    textual answer (no image block ever enters the main model's context);
 *  - the optional `vision-bridge` service: lets the host admit uploaded-image
 *    messages on a text-only route by replacing image parts with VLM
 *    descriptions before the prompt reaches the model.
 *
 * @module dsh-tool-vision
 */

import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'vision'

/** The services this plugin needs: the tool registry and the sandboxed fs. */
export const inject = ['tools', 'fs', 'systemPrompt']

/**
 * Plugin configuration. Picking a provider fills in its endpoint, wire format
 * and a starting model id, so the only thing that must be supplied is a key —
 * and nothing is assumed about which multimodal model may see your images:
 * with no key the plugin registers nothing and says so in the prompt.
 */
export const Config = z.object({
  /** Which service looks at the images; decides the endpoint and wire format. */
  provider: z.union(['qwen', 'kimi', 'openai', 'claude', 'gemini', 'custom'])
    .default('qwen').description(
      '由哪个服务来看图。选定后端点、线格式与起步模型 id 都有预设,**只需再填 apiKey**:'
      + '`qwen`(DashScope 兼容模式)、`kimi`(Moonshot)、`openai`、`claude`(Anthropic)、'
      + '`gemini`(Google);`custom` 表示自建或本地端点,此时 baseURL / model / protocol 都要自己填。',
    ),
  /** The credential for the chosen provider. */
  apiKey: z.string().default('').description(
    '所选服务的 API key。**留空则插件不生效**——不注册 `vision` 工具,并在系统提示词里'
    + '告知模型它看不了图。本机端点(localhost / 127.0.0.1)不需要 key。',
  ),
  /** Endpoint root override; empty means the provider's own. */
  baseURL: z.string().default('').description(
    '端点根地址,不含末尾路径。**留空 = 用所选 provider 的地址**;'
    + '`provider: custom` 时必填(本机 LM Studio 是 `http://127.0.0.1:1234/v1`)。',
  ),
  /** Model id override; empty means the provider's starting model. */
  model: z.string().default('').description(
    '视觉模型 id。**留空 = 用所选 provider 的起步模型**(qwen-vl-max-latest / '
    + 'moonshot-v1-8k-vision-preview / gpt-4o / claude-sonnet-5 / gemini-2.5-flash)。'
    + '预设只是起点,按你的账号权限改成它真正能用的那个。',
  ),
  /** Wire format for `provider: custom`; the named providers set their own. */
  protocol: z.union(['openai', 'anthropic', 'gemini']).default('openai').description(
    '线格式,**仅在 `provider: custom` 时生效**:`openai` 是 `/chat/completions` + '
    + 'data URI 图片,`anthropic` 是 `/messages` + base64 source 块,`gemini` 是 '
    + '`:generateContent` + inline_data。命名 provider 各自带了正确的值。',
  ),
  /** Output token cap for the VLM answer; reasoning models consume part of it. */
  maxTokens: z.number().step(1).min(1).default(8192),
  /**
   * Structured mode: the VLM is asked to return fixed-shape JSON evidence
   * (summary / ocr / layout / semantics / visual / uncertainty) which is
   * parsed and returned as an object instead of free text. Falls back to a
   * free-text answer wrapped in the same shape when parsing fails.
   */
  structured: z.boolean().default(true),
  /**
   * Keep the original image block in the message history (the UI renders its
   * thumbnail) alongside the VLM description. Requires a host whose text-only
   * serializer drops image blocks before the wire (e.g. the DSH patch in
   * llm-deepseek/serialize.ts); leave false on stock hosts, which reject
   * image content in text-only routes.
   */
  keepThumbnail: z.boolean().default(false),
  /**
   * Auto-describe pasted/uploaded images at admission time by calling the VLM
   * (tens of seconds). When false, the bridge does NOT call the VLM: the image
   * keeps its thumbnail in history and a one-line hint points the model at the
   * workspace-mirrored file, so the model decides when to read it via the
   * `vision` tool (one deliberate call instead of an automatic + a follow-up).
   */
  autoDescribe: z.boolean().default(true),
  /** Maximum wall time for one request to the vision endpoint. */
  timeoutMs: z.natural().default(180000),
  /** Maximum encoded bytes accepted for one image. */
  maxImageBytes: z.natural().default(50 * 1024 * 1024),
})

/** Extensions `vision` accepts; the VLM request carries the declared media type. */
const IMAGE_EXTENSIONS = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
}

/**
 * What each provider needs, so the only thing a user must supply is a key.
 * `protocol` is the wire format, which is what actually differs: OpenAI's
 * `/chat/completions` with a data-URI image, Anthropic's `/messages` with a
 * base64 source block, and Gemini's `:generateContent` with inline_data.
 * Qwen and Kimi both serve the OpenAI format, which is why they cost nothing
 * extra to support.
 *
 * The model ids are a starting point, not a promise about your account —
 * override `model` with whatever your key is entitled to.
 */
const PROVIDERS = {
  qwen: {
    label: 'Qwen (DashScope)',
    protocol: 'openai',
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-vl-max-latest',
  },
  kimi: {
    label: 'Kimi (Moonshot)',
    protocol: 'openai',
    baseURL: 'https://api.moonshot.cn/v1',
    model: 'moonshot-v1-8k-vision-preview',
  },
  openai: {
    label: 'OpenAI',
    protocol: 'openai',
    baseURL: 'https://api.openai.com/v1',
    model: 'gpt-4o',
  },
  claude: {
    label: 'Claude (Anthropic)',
    protocol: 'anthropic',
    baseURL: 'https://api.anthropic.com/v1',
    model: 'claude-sonnet-5',
  },
  gemini: {
    label: 'Gemini (Google)',
    protocol: 'gemini',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta',
    model: 'gemini-2.5-flash',
  },
  custom: {
    label: 'custom endpoint',
    protocol: undefined, // taken from the `protocol` field
    baseURL: '',
    model: '',
  },
}

/**
 * One entry per wire format: where to POST, what headers carry the key, how
 * the image is encoded, and where the answer lives in the reply. Everything
 * else in this plugin is protocol-agnostic.
 */
const PROTOCOLS = {
  openai: {
    url: ({ baseURL }) => baseURL + '/chat/completions',
    headers: ({ apiKey }) => (apiKey ? { Authorization: 'Bearer ' + apiKey } : {}),
    body: ({ model, maxTokens }, base64, mediaType, prompt) => ({
      model,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: 'data:' + mediaType + ';base64,' + base64 } },
        ],
      }],
      max_tokens: maxTokens,
      stream: false,
    }),
    answer: json => {
      const message = json?.choices?.[0]?.message
      // Reasoning VLMs emit the final answer in `content`, but only after
      // spending tokens on `reasoning_content`. With a tight budget they stop
      // mid-thought and leave `content` empty — prefer any non-empty field.
      const content = (message?.content ?? '').trim()
      return content.length > 0 ? content : (message?.reasoning_content ?? '').trim()
    },
  },
  anthropic: {
    url: ({ baseURL }) => baseURL + '/messages',
    headers: ({ apiKey }) => ({
      ...(apiKey ? { 'x-api-key': apiKey } : {}),
      'anthropic-version': '2023-06-01',
    }),
    body: ({ model, maxTokens }, base64, mediaType, prompt) => ({
      model,
      max_tokens: maxTokens, // required by this API, not merely a cap
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
        ],
      }],
    }),
    // The reply is a block list; a model that thinks first puts several blocks
    // there, and only the text ones are the answer.
    answer: json => (Array.isArray(json?.content) ? json.content : [])
      .filter(block => block?.type === 'text' && typeof block.text === 'string')
      .map(block => block.text)
      .join('\n')
      .trim(),
  },
  gemini: {
    // The model id is part of the path here, not the body.
    url: ({ baseURL, model }) => baseURL + '/models/' + encodeURIComponent(model) + ':generateContent',
    headers: ({ apiKey }) => (apiKey ? { 'x-goog-api-key': apiKey } : {}),
    body: ({ maxTokens }, base64, mediaType, prompt) => ({
      contents: [{
        role: 'user',
        parts: [
          { text: prompt },
          { inline_data: { mime_type: mediaType, data: base64 } },
        ],
      }],
      generationConfig: { maxOutputTokens: maxTokens },
    }),
    answer: json => (json?.candidates?.[0]?.content?.parts ?? [])
      .filter(part => typeof part?.text === 'string')
      .map(part => part.text)
      .join('\n')
      .trim(),
  },
}

/**
 * Whether an endpoint is on this machine, and so needs no key. A local
 * runtime like LM Studio serves without one; demanding a key there would make
 * the plugin refuse a working setup.
 * @param {string} baseURL - the resolved endpoint.
 * @returns {boolean} true when nothing has to be sent over the network.
 */
export function isLocalEndpoint(baseURL) {
  try {
    const { hostname } = new URL(baseURL)
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '0.0.0.0'
  } catch {
    return false
  }
}

/**
 * Resolve provider preset, explicit overrides and the key into one route,
 * plus what is still missing.
 * @param {Object} config - the validated configuration.
 * @returns {Object} the route and, when unusable, what it lacks
 */
export function resolveRoute(config) {
  const preset = PROVIDERS[config.provider] ?? PROVIDERS.custom
  const baseURL = (config.baseURL || preset.baseURL).trim().replace(/\/+$/, '')
  const model = (config.model || preset.model).trim()
  const protocol = preset.protocol ?? config.protocol
  const apiKey = config.apiKey.trim()
  const needsKey = baseURL.length > 0 && !isLocalEndpoint(baseURL)

  const missing = []
  if (baseURL.length === 0) missing.push('baseURL')
  if (model.length === 0) missing.push('model')
  if (needsKey && apiKey.length === 0) missing.push('apiKey')

  return { provider: config.provider, label: preset.label, protocol, baseURL, model, apiKey, missing }
}

/**
 * The canonical outcome declared by the `vision` output schema.
 * Structured mode: `answer` is a fixed-shape evidence object
 * (summary / ocr / layout / semantics / visual / uncertainty), so the main
 * model can quote specifics instead of trusting a free-form retelling.
 * Free-text mode keeps the legacy `answer` string.
 */
const EVIDENCE_SHAPE = {
  type: 'object',
  additionalProperties: false,
  properties: {
    summary: { type: 'string' },
    ocr: {
      type: 'object',
      additionalProperties: false,
      properties: {
        full_text: { type: 'string' },
        lines: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: { text: { type: 'string' } },
          },
        },
      },
    },
    layout: {
      type: 'object',
      additionalProperties: false,
      properties: {
        regions: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              type: { type: 'string' },
              reading_order: { type: 'number' },
              text: { type: 'string' },
            },
          },
        },
      },
    },
    semantics: {
      type: 'object',
      additionalProperties: false,
      properties: {
        scene: { type: 'string' },
        entities: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              name: { type: 'string' },
              type: { type: 'string' },
              evidence: { type: 'string' },
            },
          },
        },
        relations: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              subject: { type: 'string' },
              predicate: { type: 'string' },
              object: { type: 'string' },
            },
          },
        },
      },
    },
    visual: {
      type: 'object',
      additionalProperties: false,
      properties: {
        dominant_colors: { type: 'array', items: { type: 'string' } },
        style: { type: 'string' },
        notes: { type: 'array', items: { type: 'string' } },
      },
    },
    uncertainty: { type: 'array', items: { type: 'string' } },
  },
}

const valueShape = {
  type: 'object',
  additionalProperties: false,
  properties: {
    file: { type: 'string' },
    model: { type: 'string' },
    answer: {
      oneOf: [
        { type: 'string' },
        EVIDENCE_SHAPE,
      ],
    },
  },
}

/**
 * The fixed JSON template the VLM is asked to fill in structured mode.
 * Full transcription, reading-order layout regions, entity/relation lists,
 * and an explicit uncertainty list so the model states what it could not
 * determine instead of guessing. No pixel coordinates or confidence scores:
 * vision models tend to fabricate those, so the schema deliberately omits
 * them and relies on verbatim text plus explicit uncertainty instead.
 */
const STRUCTURED_PROMPT = `You are a vision engine reading an image. Analyze the image carefully and return ONLY a single valid JSON object with EXACTLY this shape — no markdown fences, no commentary, no extra keys:

{
  "summary": "one-paragraph overview of the image",
  "ocr": {
    "full_text": "every visible text character, transcribed verbatim, in reading order",
    "lines": [ { "text": "one text line, verbatim" } ]
  },
  "layout": {
    "regions": [
      { "type": "title|paragraph|list|table|chart|form|code|image|icon|link|nav|other",
        "reading_order": 1,
        "text": "text inside this region, or describe the region if it has no text" }
    ]
  },
  "semantics": {
    "scene": "what kind of scene or context the image shows",
    "entities": [ { "name": "entity name", "type": "person|org|place|object|brand|number|date|other", "evidence": "where in the image this entity appears" } ],
    "relations": [ { "subject": "entity A", "predicate": "relation verb", "object": "entity B" } ]
  },
  "visual": {
    "dominant_colors": [ "color names or hex" ],
    "style": "art/design style, if any",
    "notes": [ "other visual observations" ]
  },
  "uncertainty": [ "anything you could NOT determine; empty array if fully confident" ]
}

Rules:
- Transcribe text verbatim; do not paraphrase or fix typos.
- If any text is blurry/illegible/truncated, put it in uncertainty — never invent it.
- If the image is not what the question expects, say so in uncertainty.
- Return the JSON object as the entire answer.`

/**
 * Scan for the first balanced {...} JSON object starting at `text.indexOf('{')`.
 * Walks char by char, skipping strings and escapes, so nested objects and
 * prose around the JSON are handled. Returns the parsed object, or undefined
 * when the first block does not parse.
 * @param {string} text - the remaining reply, starting anywhere.
 * @returns {object | undefined}
 */
function parseFirstJsonBlock(text) {
  const start = text.indexOf('{')
  if (start === -1) return undefined
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (escaped) {
        escaped = false
      } else if (ch === '\\') {
        escaped = true
      } else if (ch === '"') {
        inString = false
      }
      continue
    }
    if (ch === '"') {
      inString = true
    } else if (ch === '{') {
      depth++
    } else if (ch === '}') {
      depth--
      if (depth === 0) {
        try {
          const parsed = JSON.parse(text.slice(start, i + 1))
          if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed
        } catch {
          return undefined
        }
      }
    }
  }
  return undefined
}

/**
 * Extract a JSON object from a VLM reply that may wrap it in markdown fences
 * or stray prose. Tries the whole reply first, then scans for the first
 * balanced {...} block from each `{` position. Returns the parsed object, or
 * undefined when no object can be recovered.
 * @param {string} text - raw VLM reply.
 * @returns {object | undefined}
 */
export function extractJsonObject(text) {
  if (typeof text !== 'string') return undefined
  const candidate = text.trim()
  try {
    const parsed = JSON.parse(candidate)
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed
  } catch {
    // fall through to the block scan
  }
  let idx = candidate.indexOf('{')
  while (idx !== -1) {
    const parsed = parseFirstJsonBlock(candidate.slice(idx))
    if (parsed !== undefined) return parsed
    idx = candidate.indexOf('{', idx + 1)
  }
  return undefined
}

/** Coerce an unknown value into a string (empty when absent). */
function asString(value) {
  return typeof value === 'string' ? value : ''
}

/** Coerce an unknown value into a string array (empty when absent). */
function asStringArray(value) {
  return Array.isArray(value) ? value.filter((v) => typeof v === 'string') : []
}

/**
 * Normalize a parsed evidence object into the exact EVIDENCE_SHAPE, filling
 * missing keys and dropping extras so the declared output schema holds.
 * @param {object | undefined} parsed - object recovered from the VLM reply.
 * @param {string} fallbackText - free-text answer used when parsing failed.
 * @returns {object} a well-formed evidence object.
 */
export function normalizeEvidence(parsed, fallbackText) {
  if (parsed === undefined) {
    // Parse failure: keep the raw text in summary and say so explicitly.
    return {
      summary: fallbackText,
      ocr: { full_text: '', lines: [] },
      layout: { regions: [] },
      semantics: { scene: '', entities: [], relations: [] },
      visual: { dominant_colors: [], style: '', notes: [] },
      uncertainty: ['VLM 未返回有效 JSON，已回退为原始文本回答'],
    }
  }
  const ocrRaw = parsed.ocr ?? {}
  const layoutRaw = parsed.layout ?? {}
  const semanticsRaw = parsed.semantics ?? {}
  const visualRaw = parsed.visual ?? {}
  const regions = Array.isArray(layoutRaw.regions)
    ? layoutRaw.regions
      .filter((r) => r !== null && typeof r === 'object')
      .map((r) => ({
        type: asString(r.type),
        reading_order: typeof r.reading_order === 'number' ? r.reading_order : 0,
        text: asString(r.text),
      }))
    : []
  const entities = Array.isArray(semanticsRaw.entities)
    ? semanticsRaw.entities
      .filter((e) => e !== null && typeof e === 'object')
      .map((e) => ({
        name: asString(e.name),
        type: asString(e.type),
        evidence: asString(e.evidence),
      }))
    : []
  const relations = Array.isArray(semanticsRaw.relations)
    ? semanticsRaw.relations
      .filter((r) => r !== null && typeof r === 'object')
      .map((r) => ({
        subject: asString(r.subject),
        predicate: asString(r.predicate),
        object: asString(r.object),
      }))
    : []
  return {
    summary: asString(parsed.summary),
    ocr: {
      full_text: asString(ocrRaw.full_text),
      lines: Array.isArray(ocrRaw.lines)
        ? ocrRaw.lines
          .filter((l) => l !== null && typeof l === 'object')
          .map((l) => ({ text: asString(l.text) }))
        : [],
    },
    layout: { regions },
    semantics: {
      scene: asString(semanticsRaw.scene),
      entities,
      relations,
    },
    visual: {
      dominant_colors: asStringArray(visualRaw.dominant_colors),
      style: asString(visualRaw.style),
      notes: asStringArray(visualRaw.notes),
    },
    uncertainty: asStringArray(parsed.uncertainty),
  }
}

/**
 * Build the vision request, scoped to the caller's abort signal plus a
 * hard timeout. Node 22 provides AbortSignal.any/timeout.
 * @param {string} baseURL - configured endpoint root.
 * @param {object} body - chat/completions payload.
 * @param {AbortSignal | undefined} signal - caller cancellation.
 * @param {number} timeoutMs - per-request wall-time cap.
 */
function buildRequest(route, wire, body, signal, timeoutMs) {
  const timeout = AbortSignal.timeout(timeoutMs)
  return fetch(wire.url(route), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...wire.headers(route) },
    body: JSON.stringify(body),
    signal: signal !== undefined ? AbortSignal.any([signal, timeout]) : timeout,
  })
}

/** The model-facing prompt: user question or a general description request. */
function buildPrompt(question, structured) {
  if (structured === true) return STRUCTURED_PROMPT
  const text = question !== undefined && question.trim().length > 0
    ? question.trim()
    : 'Describe this image in detail, including any visible text, layout, and notable elements.'
  return text
}

/**
 * One vision call: bytes + media type + prompt → answer.
 * In structured mode the VLM is asked to fill the fixed JSON template; the
 * reply is parsed into a normalized evidence object (falling back to a
 * free-text answer wrapped in the same shape when parsing fails). In
 * free-text mode it returns the plain answer string.
 * @param {object} config - resolved plugin configuration.
 * @param {Uint8Array} data - encoded image bytes.
 * @param {string} mediaType - declared image media type.
 * @param {string} prompt - the model-facing instruction.
 * @param {AbortSignal | undefined} signal - caller cancellation.
 * @param {boolean} structured - request and parse structured JSON evidence.
 * @returns {Promise<string | object>} answer text, or evidence object.
 */
async function vlmDescribe(config, data, mediaType, prompt, signal, structured = false) {
  const route = config.route
  const wire = PROTOCOLS[route.protocol]
  const base64 = Buffer.from(data).toString('base64')
  const payload = wire.body({ ...route, maxTokens: config.maxTokens }, base64, mediaType, prompt)
  let response
  try {
    response = await buildRequest(route, wire, payload, signal, config.timeoutMs)
  } catch (error) {
    // Name the endpoint: the usual cause is nothing listening there, and an
    // error that does not say where it dialled sends the model guessing.
    throw new Error('vision: request to ' + route.baseURL + ' (' + route.protocol + ') failed (' + String(error) + ')')
  }
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    // The endpoint's own body says whether the key, the model id or the
    // format was wrong; passing it through is what makes that fixable.
    throw new Error('vision: ' + route.baseURL + ' returned HTTP ' + response.status + ': ' + body.slice(0, 300))
  }
  const json = await response.json()
  const answer = wire.answer(json)
  if (answer.length === 0) throw new Error('vision: ' + route.model + ' returned an empty answer')
  if (!structured) return answer
  return normalizeEvidence(extractJsonObject(answer), answer)
}

export function apply(ctx, config) {
  const route = resolveRoute(config)
  const configured = route.missing.length === 0

  // Declare the route BEFORE the model needs it, whether or not there is one.
  // Which multimodal model reads your images is a deployment fact the model
  // cannot discover except by calling and failing — and a model that finds out
  // by failing describes the image from its filename instead of saying it
  // could not look at it. This section is registered unconditionally for the
  // same reason astock declares its data sources even when the provider is
  // absent: the model has to be able to choose its route before it commits.
  ctx.systemPrompt.section({
    name: 'vision:endpoint',
    // Required, and must be finite: the service throws otherwise, and a throw
    // in apply() fails the whole plugin tree at startup.
    order: 158,
    text: configured
      ? 'Image understanding: the `vision` tool sends an image file to ' + route.model
        + ' (' + route.label + ') and returns what that model reports. '
        + 'It is the only way you can see an image; you cannot read image bytes yourself. '
        + 'If the tool errors (nothing serving that endpoint, HTTP error, empty answer), say '
        + 'the image could not be read and what the error was. Never describe an image from '
        + 'its filename, its path, or the surrounding conversation.'
      : 'Image understanding is NOT available: the vision plugin is missing '
        + route.missing.join(' and ') + ', so there is no `vision` tool and you cannot see '
        + 'images at all. When asked about the content of an image, say plainly that you '
        + 'cannot look at it and what has to be set in the vision plugin settings. Never '
        + 'describe an image from its filename, its path, or the surrounding conversation, '
        + 'and do not substitute another tool for looking at it.',
  })

  if (!configured) {
    // Say which field, in the log as well: "it does nothing" is the report we
    // would otherwise get, and the answer is always one of these three.
    ctx.logger?.warn?.('[vision] not configured (' + route.missing.join(', ')
      + ' missing for provider ' + route.provider + '); the tool stays unregistered')
    return
  }

  // Everything below runs against the resolved route, so the request and its
  // error messages carry that rather than the raw config.
  config = { ...config, route }

  // ── Optional vision-bridge service ────────────────────────────────────────
  // Lets the host admit uploaded-image prompts on a text-only route: each image
  // part is kept (when keepThumbnail is on, so the history renders its
  // thumbnail) and followed by a VLM text description for the text-only main
  // model. The host's serializer drops the image blocks before they reach the
  // wire (the model never sees raw pixels), while the durable history still
  // carries them for the UI. On any failure we return undefined so the host
  // keeps its original refusal (no image retained, no description invented).
  ctx.provide('vision-bridge', {
    async describeImages(content) {
      let changed = false
      const out = []
      for (const part of content) {
        if (part === null || typeof part !== 'object' || part.type !== 'image') {
          out.push(part)
          continue
        }
        changed = true
        const label = part.name !== undefined && String(part.name).length > 0
          ? String(part.name)
          : '上传图片'
        if (config.autoDescribe === false) {
          // On-demand mode: do NOT call the VLM (saves tens of seconds per
          // paste). Keep the image (thumbnail) and drop a one-line hint that
          // points the model at the workspace-mirrored file, so it reads the
          // image via the `vision` tool when it actually needs it — one
          // deliberate recognition instead of an automatic one plus a
          // follow-up. Requires keepThumbnail (or the hint alone is useless).
          if (config.keepThumbnail === true) out.push(part)
          out.push({
            type: 'text',
            text: '【图片 ' + label + ' 已上传，可用 vision 工具读取工作区中的该文件查看内容】',
          })
          continue
        }
        try {
          const data = Buffer.from(String(part.data ?? ''), 'base64')
          const answer = await vlmDescribe(config, data, String(part.mediaType), buildPrompt(undefined, config.structured), undefined, config.structured)
          if (config.keepThumbnail === true) {
            // Keep the original image part so the history keeps its thumbnail;
            // the description follows as a sibling text block. Requires a host
            // whose serializer drops image blocks on text-only routes.
            out.push(part)
          }
          // Structured evidence would bury the answer in JSON; the bridge
          // message is for the main model, so surface the summary (or the raw
          // text) plus a hint that the image was already read locally — the
          // main model must not go hunting for the original file on disk.
          const shown = typeof answer === 'object' && answer !== null
            ? (answer.summary.length > 0 ? answer.summary : answer.ocr.full_text)
            : answer
          out.push({ type: 'text', text: '【' + label + '】' + shown + '（已由本地视觉模型识别，无需查找原文件）' })
        } catch (error) {
          ctx.logger.warn('[tool-vision] vision-bridge describe failed: ' + String(error))
          return undefined
        }
      }
      return changed ? out : undefined
    },
  })

  ctx.tools.register(defineTool({
    name: 'vision',
    description:
      'Describe or answer questions about an image file using the configured vision model. '
      + 'Use this when the user asks about the content of an image (a screenshot, photo, diagram, UI, chart, '
      + 'or any picture file) — e.g. to recognize text, layout, objects, or visual details. '
      + 'Returns the vision model\'s textual answer; the image itself never enters the main model\'s context. '
      + 'Accepts PNG/JPEG/WebP/GIF paths, absolute or relative to the session workspace.',
    parameters: {
      file_path: {
        type: 'string',
        required: true,
        description: 'Path to the image file, resolved by the filesystem backend.',
      },
      question: {
        type: 'string',
        description: 'Optional question or instruction for the vision model (e.g. "What does this screenshot show?" or "Extract all text"). Defaults to a general description.',
      },
    },
    output: {
      schema: valueShape,
      render: (_args, value) => {
        const answer = value.answer
        let body
        if (typeof answer === 'string') {
          body = answer
        } else {
          const lines = [
            answer.summary,
            '',
            'OCR: ' + (answer.ocr.full_text || '—'),
            '布局区域: ' + answer.layout.regions.map((r) => '[' + r.type + '] ' + r.text).join(' | '),
            '实体: ' + answer.semantics.entities.map((e) => e.name + '(' + e.type + ')').join(', '),
            '关系: ' + answer.semantics.relations.map((r) => r.subject + ' ' + r.predicate + ' ' + r.object).join('; '),
            '视觉: ' + [answer.visual.style, answer.visual.dominant_colors.join(', ')].filter(Boolean).join(' | '),
            '不确定项: ' + (answer.uncertainty.length > 0 ? answer.uncertainty.join('; ') : '无'),
          ]
          body = lines.filter((l, i) => !(i > 0 && l === '')).join('\n')
        }
        return [{
          type: 'text',
          text: '[vision:' + value.model + '] ' + value.file + '\n' + body,
        }]
      },
    },
    // The plugin's own request cap is config.timeoutMs; this sits above it so
    // a slow endpoint reports "request to <url> failed" rather than being cut
    // down by the tool-call timeout with no reason attached.
    timeoutMs: config.timeoutMs + 15000,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const requestedPath = args.file_path.trim()
      if (requestedPath.length === 0) throw new Error('vision: file_path must be a non-empty string')

      const ext = requestedPath.slice(requestedPath.lastIndexOf('.')).toLowerCase()
      const mediaType = IMAGE_EXTENSIONS[ext]
      if (mediaType === undefined) {
        throw new Error('vision: "' + requestedPath + '" is not a PNG/JPEG/WebP/GIF image path')
      }

      // Resolve against the calling session's workspace, like the read tools.
      const cwd = exec.agent?.session.header.cwd
      const target = await ctx.fs.resolve(requestedPath, {
        ...(cwd !== undefined ? { cwd } : {}),
        signal: exec.signal,
      })
      const info = await ctx.fs.stat(target, exec.signal)
      if (info === undefined) {
        ctx.emit('fs/observed', target, { kind: 'absent' }, exec)
        throw new Error('vision: "' + target.displayPath + '" not found')
      }
      if (info.type !== 'file') {
        throw new Error('vision: "' + target.displayPath + '" is not a regular file')
      }

      const data = await ctx.fs.readBytes(target, exec.signal, config.maxImageBytes)
      ctx.emit('fs/observed', target, { kind: 'present', version: info.version }, exec)

      const answer = await vlmDescribe(config, data, mediaType, buildPrompt(args.question, config.structured), exec.signal, config.structured)

      return {
        // The resolved model, not the configured one: with a provider preset
        // the config field is empty, and a value saying '' would misattribute
        // every answer in the transcript.
        file: target.displayPath,
        model: route.model,
        answer,
      }
    },
    presentCall(args) {
      return {
        card: 'generic',
        title: 'Vision ' + args.file_path,
        kind: 'read',
        locations: [{ path: args.file_path }],
      }
    },
  }))
}