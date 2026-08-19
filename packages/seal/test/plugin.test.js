import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as plugin from '../lib/index.js'

/** @returns {Object} a context recording what the plugin registers */
function fakeContext() {
  const tools = []
  const sections = []
  const ctx = {
    tools: { register: tool => tools.push(tool) },
    systemPrompt: { section: section => sections.push(section) },
    fs: {},
    on: () => () => {},
    effect: () => {},
    logger: { warn: () => {} },
  }
  return { ctx, tools, sections }
}

test('the plugin exports the named shape a loader entry needs', () => {
  assert.equal('default' in plugin, false)
  assert.equal(plugin.name, 'seal')
  assert.equal(typeof plugin.apply, 'function')
  assert.deepEqual(plugin.inject, ['tools', 'fs', 'systemPrompt'])
})

test('both stamps are registered, with schemas a closed output demands', () => {
  const { ctx, tools } = fakeContext()
  plugin.apply(ctx, new plugin.Config())

  assert.deepEqual(tools.map(tool => tool.name).sort(), ['seal_stamp', 'seal_straddle'])
  for (const tool of tools) {
    assert.ok(tool.output.schema, `${tool.name} declares an output schema`)
    assert.equal(typeof tool.output.render, 'function')
    assert.ok(tool.timeoutMs > 0, `${tool.name} declares a timeout`)
    // Writing a file twice concurrently over the same path is not a race worth
    // having.
    assert.equal(tool.isConcurrencySafe(), false)

    const open = []
    const walk = (node, path) => {
      if (node === null || typeof node !== 'object') return
      if (node.type === 'object' && !('additionalProperties' in node)) open.push(path)
      for (const [key, child] of Object.entries(node)) walk(child, `${path}.${key}`)
    }
    walk(tool.output.schema, tool.name)
    assert.deepEqual(open, [])
  }
})

test('the model is told what a stamped image is not, before it can stamp', () => {
  // The assumption this exists to break: that a seal on a PDF is a signature.
  const { ctx, sections } = fakeContext()
  plugin.apply(ctx, new plugin.Config())

  assert.deepEqual(sections.map(section => section.name), ['seal:capability'])
  const text = sections[0].text
  assert.match(text, /not an electronic signature/)
  assert.match(text, /电子签名法/)
  assert.match(text, /certificate/)
  assert.match(text, /do not draw or invent a seal/, 'the seal is the user\'s own, not generated')
})

test('both tool descriptions repeat the limit, since a description is what the model reads', () => {
  const { ctx, tools } = fakeContext()
  plugin.apply(ctx, new plugin.Config())
  for (const tool of tools) {
    assert.match(tool.description, /RENDERS an image only|not an electronic signature|not make the document cryptographically/,
      `${tool.name} does not say what it is not`)
  }
})

test('the output goes beside the original unless told otherwise', () => {
  // Stamping is not reversible, and the unsealed original is what a dispute
  // gets compared against.
  assert.equal(
    plugin.outputPathFor({ input: '/tmp/contract.pdf', requested: undefined, overwrite: false }),
    '/tmp/contract.sealed.pdf',
  )
  assert.equal(
    plugin.outputPathFor({ input: '/tmp/contract.pdf', requested: '  /tmp/out.pdf ', overwrite: false }),
    '/tmp/out.pdf',
  )
  assert.equal(
    plugin.outputPathFor({ input: '/tmp/contract.pdf', requested: undefined, overwrite: true }),
    '/tmp/contract.pdf',
  )
})

test('the default seal size is a real seal size', () => {
  const config = new plugin.Config()
  assert.equal(config.widthMm, 40, 'a 公章 is 40mm across')
  assert.equal(config.sealPath, '', 'no seal is assumed; it is the user\'s own file')
  assert.equal(config.overwrite, false)
  assert.ok(config.maxPagesPerSeal >= 2)
})
