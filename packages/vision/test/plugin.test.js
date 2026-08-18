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

const config = new plugin.Config({ baseURL: 'http://127.0.0.1:1234/v1', model: 'some-vlm' })

test('the plugin exports the named shape a loader entry needs', () => {
  // A default export makes the loader drop the namespace and `inject` then
  // silently does nothing.
  assert.equal('default' in plugin, false)
  assert.equal(plugin.name, 'vision')
  assert.equal(typeof plugin.apply, 'function')
  assert.deepEqual(plugin.inject, ['tools', 'fs', 'systemPrompt'])
})

test('a provider preset supplies everything except the key', () => {
  // Picking a provider is a choice; holding a key is a fact. The preset fills
  // in what is knowable and leaves the one thing only the user has.
  const bare = new plugin.Config()
  assert.equal(bare.provider, 'qwen')
  assert.equal(bare.apiKey, '', 'nothing is assumed about who may see your images')
  assert.equal(bare.baseURL, '', 'empty means "the provider\'s own endpoint"')
  assert.equal(bare.model, '')

  const route = plugin.resolveRoute(bare)
  assert.match(route.baseURL, /^https:\/\//)
  assert.ok(route.model.length > 0)
  assert.equal(route.protocol, 'openai', 'Qwen serves the OpenAI wire format')
  assert.deepEqual(route.missing, ['apiKey'])
})

test('each provider resolves to its own endpoint and wire format', () => {
  const protocolOf = provider => plugin.resolveRoute(new plugin.Config({ provider, apiKey: 'k' }))
  assert.equal(protocolOf('kimi').protocol, 'openai')
  assert.equal(protocolOf('openai').protocol, 'openai')
  assert.equal(protocolOf('claude').protocol, 'anthropic')
  assert.equal(protocolOf('gemini').protocol, 'gemini')
  assert.deepEqual(protocolOf('kimi').missing, [])

  const hosts = ['qwen', 'kimi', 'openai', 'claude', 'gemini']
    .map(provider => new URL(protocolOf(provider).baseURL).host)
  assert.equal(new Set(hosts).size, hosts.length, 'no two providers share an endpoint')
})

test('a custom provider must be told everything, including the format', () => {
  const custom = plugin.resolveRoute(new plugin.Config({ provider: 'custom', protocol: 'anthropic' }))
  assert.deepEqual(custom.missing, ['baseURL', 'model'])
  assert.equal(custom.protocol, 'anthropic', 'the protocol field applies only here')
})

test('a local endpoint needs no key', () => {
  // LM Studio and friends serve without one; demanding a key there would
  // refuse a working setup.
  const local = plugin.resolveRoute(new plugin.Config({
    provider: 'custom', baseURL: 'http://127.0.0.1:1234/v1', model: 'qwen3.5-9b-vlm',
  }))
  assert.deepEqual(local.missing, [])
  assert.equal(plugin.isLocalEndpoint('http://localhost:1234/v1'), true)
  assert.equal(plugin.isLocalEndpoint('https://api.moonshot.cn/v1'), false)
  assert.equal(plugin.isLocalEndpoint('not a url'), false)
})

test('with no endpoint it registers nothing and says why', () => {
  const { ctx, tools, sections, provided } = fakeContext()
  plugin.apply(ctx, new plugin.Config())

  assert.deepEqual(tools, [], 'an unusable tool in the catalog costs prompt budget and invites a call')
  assert.deepEqual(provided, [], 'a bridge with nowhere to send images is not a bridge')
  // The statement still has to be there: silence is what makes a model
  // describe a picture it never saw.
  assert.deepEqual(sections.map(section => section.name), ['vision:endpoint'])
  assert.match(sections[0].text, /NOT available/)
  assert.match(sections[0].text, /filename/)
})

test('a missing key is named, in the log and in the prompt', () => {
  const { ctx, tools, sections } = fakeContext()
  const warnings = []
  ctx.logger.warn = message => warnings.push(message)
  plugin.apply(ctx, new plugin.Config())

  assert.deepEqual(tools, [])
  // "It does nothing" is the report we would otherwise get, and the answer is
  // always one of three fields.
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /apiKey/)
  assert.match(warnings[0], /qwen/)
  assert.match(sections[0].text, /apiKey/)
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

  assert.ok(text.includes(config.model), 'the model doing the looking is named')
  assert.doesNotMatch(text, /apiKey|sk-/, 'the credential itself is never part of the prompt')
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
