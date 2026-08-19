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

test('all four tools are registered, with schemas a closed output demands', () => {
  const { ctx, tools } = fakeContext()
  plugin.apply(ctx, new plugin.Config())

  assert.deepEqual(tools.map(tool => tool.name).sort(), ['seal_cert', 'seal_sign', 'seal_stamp', 'seal_straddle'])
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

test('the model is told what a stamp is not, and in which order to work', () => {
  // Two assumptions this exists to break: that a seal on a PDF is a signature,
  // and that stamping a signed document is harmless. The second is silent —
  // the file still opens, and every viewer calls it modified.
  const { ctx, sections } = fakeContext()
  plugin.apply(ctx, new plugin.Config())

  assert.deepEqual(sections.map(section => section.name), ['seal:capability'])
  const text = sections[0].text
  assert.match(text, /That is not a signature/)
  assert.match(text, /电子签名法/)
  assert.match(text, /stamp first, sign last/i)
  assert.match(text, /self-signed certificate produces a valid signature by an unidentified/)
  assert.match(text, /Only ONE signature/)
  // The free certificate path exists, and its limit has to travel with it.
  assert.match(text, /SELF-SIGNED certificate for free/)
  assert.match(text, /proves no identity on its own/)
})

test('each tool description carries its own limit, since that is what the model reads', () => {
  const { ctx, tools } = fakeContext()
  plugin.apply(ctx, new plugin.Config())
  const by = name => tools.find(tool => tool.name === name).description

  for (const name of ['seal_stamp', 'seal_straddle']) {
    assert.match(by(name), /RENDERS an image only|not an electronic signature|not make the document cryptographically/,
      `${name} does not say that it is not a signature`)
  }
  assert.match(by('seal_sign'), /Sign LAST/, 'the ordering rule belongs on the tool that depends on it')
  assert.match(by('seal_sign'), /self-signed/, 'the trust limit is on the tool too')
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

test('stamping an already-signed document is refused, not quietly done', () => {
  // Stamping rewrites the file, so the existing signature ends up covering
  // bytes that no longer exist: every viewer then reports the document as
  // modified, and the party who signed gets blamed for a change they did not
  // make.
  const signed = Buffer.from('%PDF-1.7\n/Type /Sig\n/ByteRange [0 100 200 300]\n')
  assert.throws(() => plugin.refuseIfSigned(signed), /already signed/)
  assert.throws(() => plugin.refuseIfSigned(signed), /Stamp the unsigned original/)
  assert.doesNotThrow(() => plugin.refuseIfSigned(Buffer.from('%PDF-1.7\nplain\n')))
})
