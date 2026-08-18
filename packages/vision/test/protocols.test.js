import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as plugin from '../lib/index.js'

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])

/**
 * Mount the plugin for one provider and capture the request it makes.
 * @param {Object} overrides - config overrides, plus `reply` for the endpoint.
 * @returns {Object} the tool and the captured request
 */
function mount({ reply, ...overrides }) {
  const tools = []
  const ctx = {
    tools: { register: tool => tools.push(tool) },
    systemPrompt: { section: () => {} },
    provide: () => {},
    on: () => () => {},
    effect: () => {},
    emit: () => {},
    logger: { warn: () => {} },
    fs: {
      resolve: async path => ({ displayPath: path }),
      stat: async () => ({ type: 'file', version: 1 }),
      readBytes: async () => PNG,
    },
  }
  plugin.apply(ctx, new plugin.Config({ apiKey: 'secret-key', structured: false, ...overrides }))

  const sent = []
  globalThis.fetch = async (url, init) => {
    sent.push({ url, headers: init.headers, body: JSON.parse(init.body) })
    return { ok: true, status: 200, json: async () => reply }
  }
  return { tool: tools[0], sent }
}

/**
 * @param {Object} options - provider and the reply its API would give.
 * @returns {Promise<Object>} the request that went out and the value returned
 */
async function callWith(options) {
  const { tool, sent } = mount(options)
  const value = await tool.execute({ file_path: 'shot.png' }, { signal: undefined })
  return { request: sent[0], value }
}

test('OpenAI-format providers post chat/completions with a data URI', async () => {
  const { request, value } = await callWith({
    provider: 'kimi',
    reply: { choices: [{ message: { content: 'a cat' } }] },
  })

  assert.equal(request.url, 'https://api.moonshot.cn/v1/chat/completions')
  assert.equal(request.headers.Authorization, 'Bearer secret-key')
  const image = request.body.messages[0].content.find(part => part.type === 'image_url')
  assert.ok(image.image_url.url.startsWith('data:image/png;base64,'))
  assert.equal(request.body.model, 'moonshot-v1-8k-vision-preview')
  assert.equal(value.answer, 'a cat')
})

test('Qwen is the default and rides the same format', async () => {
  const { request } = await callWith({ reply: { choices: [{ message: { content: 'ok' } }] } })
  assert.match(request.url, /dashscope\.aliyuncs\.com.*\/chat\/completions$/)
  assert.equal(request.headers.Authorization, 'Bearer secret-key')
})

test('Claude posts messages with a base64 source block', async () => {
  const { request, value } = await callWith({
    provider: 'claude',
    reply: { content: [{ type: 'text', text: 'a cat' }] },
  })

  assert.equal(request.url, 'https://api.anthropic.com/v1/messages')
  assert.equal(request.headers['x-api-key'], 'secret-key', 'this API does not take a bearer token')
  assert.equal(request.headers['anthropic-version'], '2023-06-01', 'the version header is required')
  assert.equal(request.headers.Authorization, undefined)

  const image = request.body.messages[0].content.find(part => part.type === 'image')
  assert.deepEqual(image.source, { type: 'base64', media_type: 'image/png', data: Buffer.from(PNG).toString('base64') })
  assert.ok(request.body.max_tokens > 0, 'max_tokens is required here, not merely a cap')
  assert.equal(value.answer, 'a cat')
})

test('Claude replies are read as a block list, not a string', async () => {
  // A model that thinks first returns several blocks; only the text ones are
  // the answer, and `json.content` as a whole is an array.
  const { value } = await callWith({
    provider: 'claude',
    reply: {
      content: [
        { type: 'thinking', thinking: 'hmm' },
        { type: 'text', text: 'first half' },
        { type: 'text', text: 'second half' },
      ],
    },
  })
  assert.equal(value.answer, 'first half\nsecond half')
})

test('Gemini puts the model in the path and the image in inline_data', async () => {
  const { request, value } = await callWith({
    provider: 'gemini',
    reply: { candidates: [{ content: { parts: [{ text: 'a cat' }] } }] },
  })

  assert.equal(
    request.url,
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
  )
  assert.equal(request.headers['x-goog-api-key'], 'secret-key')
  const image = request.body.contents[0].parts.find(part => part.inline_data !== undefined)
  assert.equal(image.inline_data.mime_type, 'image/png')
  assert.ok(request.body.generationConfig.maxOutputTokens > 0, 'the token cap has its own name here')
  assert.equal(value.answer, 'a cat')
})

test('a model id with characters that need escaping stays a single path segment', async () => {
  const { request } = await callWith({
    provider: 'gemini',
    model: 'models/weird one',
    reply: { candidates: [{ content: { parts: [{ text: 'x' }] } }] },
  })
  assert.ok(request.url.endsWith('/models/models%2Fweird%20one:generateContent'))
})

test('a custom endpoint speaks whichever format it is told to', async () => {
  const { request } = await callWith({
    provider: 'custom',
    protocol: 'anthropic',
    baseURL: 'https://gateway.example/v1/',
    model: 'some-vlm',
    reply: { content: [{ type: 'text', text: 'x' }] },
  })
  // The trailing slash on the configured baseURL must not double up.
  assert.equal(request.url, 'https://gateway.example/v1/messages')
})

test('a local endpoint is called without an Authorization header', async () => {
  const { request } = await callWith({
    provider: 'custom',
    apiKey: '',
    baseURL: 'http://127.0.0.1:1234/v1',
    model: 'qwen3.5-9b-vlm',
    reply: { choices: [{ message: { content: 'x' } }] },
  })
  assert.equal(request.headers.Authorization, undefined, 'a local runtime has no key to send')
})

test('an empty reply is an error in every format', async () => {
  const cases = [
    ['kimi', { choices: [{ message: { content: '' } }] }],
    ['claude', { content: [] }],
    ['gemini', { candidates: [] }],
  ]
  for (const [provider, reply] of cases) {
    const { tool } = mount({ provider, reply })
    await assert.rejects(
      tool.execute({ file_path: 'shot.png' }, { signal: undefined }),
      /returned an empty answer/,
      `${provider} must not pass an empty answer off as a description`,
    )
  }
})

test('an endpoint error never carries the key back to the model', async () => {
  const tools = []
  const ctx = {
    tools: { register: tool => tools.push(tool) },
    systemPrompt: { section: () => {} },
    provide: () => {},
    on: () => () => {},
    effect: () => {},
    emit: () => {},
    logger: { warn: () => {} },
    fs: {
      resolve: async path => ({ displayPath: path }),
      stat: async () => ({ type: 'file', version: 1 }),
      readBytes: async () => PNG,
    },
  }
  plugin.apply(ctx, new plugin.Config({ provider: 'kimi', apiKey: 'sk-do-not-leak' }))
  globalThis.fetch = async () => ({ ok: false, status: 401, text: async () => 'invalid api key' })

  await assert.rejects(
    tools[0].execute({ file_path: 'shot.png' }, { signal: undefined }),
    error => error.message.includes('401')
      && error.message.includes('invalid api key')
      && !error.message.includes('sk-do-not-leak'),
  )
})
