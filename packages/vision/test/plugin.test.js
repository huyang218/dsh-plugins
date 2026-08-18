import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as plugin from '../lib/index.js'

/**
 * A context that records what the plugin registers, with the services the
 * plugin declares. Nothing here reaches the network.
 * @returns {Object} the fake context and what it captured
 */
function fakeContext() {
  const tools = []
  const sections = []
  const provided = []
  const ctx = {
    tools: { register: tool => tools.push(tool) },
    systemPrompt: { section: section => sections.push(section) },
    provide: (name, value) => provided.push([name, value]),
    fs: {},
    on: () => () => {},
    effect: () => {},
    logger: { warn: () => {} },
  }
  return { ctx, tools, sections, provided }
}

const config = new plugin.Config()

test('the plugin exports the named shape a loader entry needs', () => {
  // A default export makes the loader drop the namespace and `inject` then
  // silently does nothing.
  assert.equal('default' in plugin, false)
  assert.equal(plugin.name, 'vision')
  assert.equal(typeof plugin.apply, 'function')
  assert.deepEqual(plugin.inject, ['tools', 'fs', 'systemPrompt'])
})

test('config defaults describe a complete endpoint', () => {
  assert.match(config.baseURL, /^https?:\/\//)
  assert.ok(config.model.length > 0)
  assert.equal(config.structured, true)
  assert.ok(config.timeoutMs > 0)
})

test('apply registers the tool, the bridge and the capability statement', () => {
  const { ctx, tools, sections, provided } = fakeContext()
  plugin.apply(ctx, config)

  assert.deepEqual(tools.map(tool => tool.name), ['vision'])
  assert.deepEqual(provided.map(([name]) => name), ['vision-bridge'])
  assert.deepEqual(sections.map(section => section.name), ['vision:endpoint'])
})

test('the capability statement names the route and forbids guessing', () => {
  // The failure this prevents is a model that cannot reach the endpoint and
  // describes the picture from its filename instead of saying so.
  const { ctx, sections } = fakeContext()
  plugin.apply(ctx, config)
  const text = sections[0].text

  assert.ok(text.includes(config.baseURL), 'the endpoint is stated before it is needed')
  assert.ok(text.includes(config.model), 'the model doing the looking is named')
  assert.match(text, /filename/, 'describing an image from its filename is ruled out explicitly')
})

test('the tool declares a timeout above its own request cap', () => {
  // Without this the tool-call timeout policy cuts the call down with no
  // reason attached, instead of the request failing and naming the endpoint.
  const { ctx, tools } = fakeContext()
  plugin.apply(ctx, config)
  assert.ok(tools[0].timeoutMs > config.timeoutMs, 'a tool timeout below the request cap hides the cause')
})

test('the output schema closes every object it declares', () => {
  // defineTool throws on a missing additionalProperties at definition time,
  // which takes the whole plugin tree down at startup. Checking the shape
  // here says which node, rather than which plugin.
  const open = []
  const walk = (node, path) => {
    if (node === null || typeof node !== 'object') return
    if (node.type === 'object' && !('additionalProperties' in node)) open.push(path)
    for (const [key, child] of Object.entries(node)) walk(child, `${path}.${key}`)
  }
  const { ctx, tools } = fakeContext()
  plugin.apply(ctx, config)
  walk(tools[0].output.schema, 'schema')
  assert.deepEqual(open, [])
})

test('render quotes the evidence instead of retelling it', () => {
  const { ctx, tools } = fakeContext()
  plugin.apply(ctx, config)
  const text = tools[0].output.render({}, {
    file: 'shot.png',
    model: 'some-vlm',
    answer: {
      summary: 'A login screen.',
      ocr: { full_text: 'Sign in', lines: [{ text: 'Sign in' }] },
      layout: { regions: [{ type: 'title', reading_order: 1, text: 'Sign in' }] },
      semantics: { scene: 'ui', entities: [{ name: 'Acme', type: 'brand', evidence: 'top left' }], relations: [] },
      visual: { dominant_colors: ['#fff'], style: 'flat', notes: [] },
      uncertainty: ['the small print is illegible'],
    },
  })[0].text

  assert.ok(text.includes('shot.png') && text.includes('some-vlm'), 'the source is attributed')
  assert.ok(text.includes('Sign in'), 'the transcribed text is carried through verbatim')
  assert.ok(text.includes('the small print is illegible'),
    'what the vision model could not determine has to reach the main model')
})

test('a free-text answer renders as itself', () => {
  const { ctx, tools } = fakeContext()
  plugin.apply(ctx, config)
  const text = tools[0].output.render({}, { file: 'a.png', model: 'm', answer: 'just prose' })[0].text
  assert.ok(text.includes('just prose'))
})

test('the tool refuses a path it cannot send', async () => {
  const { ctx, tools } = fakeContext()
  plugin.apply(ctx, config)
  const execute = args => tools[0].execute(args, { signal: undefined })

  await assert.rejects(execute({ file_path: '   ' }), /non-empty/)
  // A .pdf or .txt would otherwise be base64'd into an image_url and the
  // endpoint would answer something about nothing.
  await assert.rejects(execute({ file_path: 'notes.pdf' }), /not a PNG\/JPEG\/WebP\/GIF/)
})
