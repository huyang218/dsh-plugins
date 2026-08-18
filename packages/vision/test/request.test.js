import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as plugin from '../lib/index.js'

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])

/**
 * Mount the plugin over a fake filesystem and a fake endpoint, and hand back
 * the tool plus whatever was sent.
 * @param {Object} options - `reply` (a fetch stand-in) and config overrides.
 * @returns {Object} the tool, the captured requests, and the config in force
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
  const config = new plugin.Config(overrides)
  plugin.apply(ctx, config)

  const sent = []
  globalThis.fetch = async (url, init) => {
    sent.push({ url, body: JSON.parse(init.body) })
    return reply(url, init)
  }

  return { tool: tools[0], sent, config }
}

/**
 * @param {Object} body - the JSON an OpenAI-compatible endpoint would return.
 * @returns {Function} a fetch stand-in returning it
 */
function replies(body) {
  return async () => ({ ok: true, status: 200, json: async () => body })
}

const answered = content => replies({ choices: [{ message: { content } }] })

test('the image is sent to the vision endpoint as a data URI', async () => {
  const { tool, sent, config } = mount({ reply: answered('{"summary":"a cat"}') })
  await tool.execute({ file_path: 'cat.png' }, { signal: undefined })

  assert.equal(sent.length, 1)
  assert.equal(sent[0].url, `${config.baseURL}/chat/completions`)
  const parts = sent[0].body.messages[0].content
  const image = parts.find(part => part.type === 'image_url')
  assert.ok(image.image_url.url.startsWith('data:image/png;base64,'),
    'the media type travels with the bytes; an endpoint cannot sniff a data URI')
  assert.equal(sent[0].body.stream, false)
})

test('the canonical value carries the evidence, not the raw reply', async () => {
  const { tool } = mount({
    reply: answered('```json\n{"summary":"a cat on a mat","uncertainty":["the tag is blurry"]}\n```'),
  })
  const value = await tool.execute({ file_path: 'cat.png' }, { signal: undefined })

  assert.equal(value.file, 'cat.png')
  assert.equal(value.answer.summary, 'a cat on a mat')
  assert.deepEqual(value.answer.uncertainty, ['the tag is blurry'])
})

test('free-text mode returns the answer as a string', async () => {
  const { tool } = mount({ structured: false, reply: answered('It is a cat.') })
  const value = await tool.execute({ file_path: 'cat.png' }, { signal: undefined })
  assert.equal(value.answer, 'It is a cat.')
})

test('a reasoning model that never reaches its answer still reports something', async () => {
  // These models spend the token budget on reasoning_content and can stop
  // mid-thought, leaving content empty.
  const { tool } = mount({
    structured: false,
    reply: replies({ choices: [{ message: { content: '', reasoning_content: 'Looks like a cat…' } }] }),
  })
  const value = await tool.execute({ file_path: 'cat.png' }, { signal: undefined })
  assert.equal(value.answer, 'Looks like a cat…')
})

test('an unreachable endpoint fails by name', async () => {
  // The usual cause is nothing listening there. An error that does not say
  // where it dialled leaves the model to guess whether the plugin, the model
  // or the file was wrong.
  const { tool, config } = mount({
    reply: async () => { throw new Error('ECONNREFUSED') },
  })
  await assert.rejects(
    tool.execute({ file_path: 'cat.png' }, { signal: undefined }),
    error => error.message.includes(config.baseURL) && error.message.includes('ECONNREFUSED'),
  )
})

test('an HTTP error carries the status and the endpoint', async () => {
  const { tool, config } = mount({
    reply: async () => ({ ok: false, status: 404, text: async () => 'no such model' }),
  })
  await assert.rejects(
    tool.execute({ file_path: 'cat.png' }, { signal: undefined }),
    error => error.message.includes('404')
      && error.message.includes('no such model')
      && error.message.includes(config.baseURL),
  )
})

test('an empty answer is an error, not an empty description', async () => {
  const { tool, config } = mount({ reply: replies({ choices: [{ message: { content: '' } }] }) })
  await assert.rejects(
    tool.execute({ file_path: 'cat.png' }, { signal: undefined }),
    error => error.message.includes(config.model),
  )
})

test('a missing file is reported before anything is sent', async () => {
  const tools = []
  const ctx = {
    tools: { register: tool => tools.push(tool) },
    systemPrompt: { section: () => {} },
    provide: () => {},
    on: () => () => {},
    effect: () => {},
    emit: () => {},
    logger: { warn: () => {} },
    fs: { resolve: async path => ({ displayPath: path }), stat: async () => undefined },
  }
  plugin.apply(ctx, new plugin.Config())

  let called = false
  globalThis.fetch = async () => { called = true }
  await assert.rejects(tools[0].execute({ file_path: 'gone.png' }, { signal: undefined }), /not found/)
  assert.equal(called, false, 'a request for a file that is not there is not worth making')
})
