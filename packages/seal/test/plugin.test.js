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
    webServer: { register: () => () => {} },
    on: () => () => {},
    effect: () => {},
    inject: () => {},
    logger: { warn: () => {}, info: () => {} },
  }
  return { ctx, tools, sections }
}

test('the plugin exports the named shape a loader entry needs', () => {
  assert.equal('default' in plugin, false)
  assert.equal(plugin.name, 'seal')
  assert.equal(typeof plugin.apply, 'function')
  // webServer is NOT here: it is needed only by the client's settings route,
  // and a top-level declaration makes a profile without a web server fail to
  // boot with "waiting for service: webServer" — stamping included.
  assert.deepEqual(plugin.inject, ['tools', 'fs', 'systemPrompt'])
})

test('all five tools are registered, with schemas a closed output demands', () => {
  const { ctx, tools } = fakeContext()
  plugin.apply(ctx, new plugin.Config())

  assert.deepEqual(tools.map(tool => tool.name).sort(), ['seal_cert', 'seal_sign', 'seal_stamp', 'seal_straddle', 'seal_to_pdf'])
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

test('the certificate and passphrase can come from settings instead of every call', () => {
  // The point of configuring them: seal_sign(pdf_path) alone should work.
  const config = new plugin.Config({ p12Path: '/keys/company.p12', passphrase: 'from-settings' })
  const resolved = plugin.resolveCredential({ config, args: {}, env: {} })

  assert.equal(resolved.p12Path, '/keys/company.p12')
  assert.equal(resolved.passphrase, 'from-settings')
  assert.equal(resolved.passphraseFrom, 'settings')
})

test('an environment variable beats the plaintext setting, and a call beats both', () => {
  const config = new plugin.Config({
    p12Path: '/keys/company.p12',
    passphraseEnv: 'SEAL_PASS',
    passphrase: 'from-settings',
  })

  assert.equal(plugin.resolveCredential({ config, args: {}, env: { SEAL_PASS: 'from-env' } }).passphrase, 'from-env')
  assert.equal(
    plugin.resolveCredential({ config, args: { passphrase: 'from-call' }, env: { SEAL_PASS: 'from-env' } }).passphrase,
    'from-call',
  )
  // The path is overridable per call too, for signing with a different party's
  // certificate without changing the settings.
  assert.equal(
    plugin.resolveCredential({ config, args: { p12_path: '/keys/other.p12', passphrase: 'x' }, env: {} }).p12Path,
    '/keys/other.p12',
  )
})

test('a named environment variable that is not set is an error, not a silent fallback', () => {
  // Falling back to the plaintext field would sign with a different credential
  // than the operator configured, and the file would look fine.
  const config = new plugin.Config({ p12Path: '/keys/c.p12', passphraseEnv: 'SEAL_PASS', passphrase: 'other' })
  assert.throws(() => plugin.resolveCredential({ config, args: {}, env: {} }), /SEAL_PASS/)
  assert.throws(() => plugin.resolveCredential({ config, args: {}, env: { SEAL_PASS: '' } }), /empty or unset/)
})

test('signing with no certificate anywhere says where to get one', () => {
  assert.throws(
    () => plugin.resolveCredential({ config: new plugin.Config(), args: {}, env: {} }),
    /seal_cert to make one/,
  )
})

test('a plaintext passphrase in settings is warned about once, at startup', () => {
  const { ctx } = fakeContext()
  const warnings = []
  ctx.logger.warn = message => warnings.push(message)
  plugin.apply(ctx, new plugin.Config({ passphrase: 'secret' }))
  assert.ok(warnings.some(message => message.includes('plaintext')))

  const quiet = fakeContext()
  const quietWarnings = []
  quiet.ctx.logger.warn = message => quietWarnings.push(message)
  plugin.apply(quiet.ctx, new plugin.Config({ passphraseEnv: 'SEAL_PASS' }))
  assert.deepEqual(quietWarnings, [], 'the environment-variable route is the recommended one and says nothing')
})

/**
 * A context whose filesystem serves the given files, so a tool can be executed
 * without touching the real disk for input.
 * @param {Object} files - path to bytes.
 * @returns {Object} the context and what was registered
 */
function contextOver(files) {
  const captured = fakeContext()
  captured.ctx.fs = {
    resolve: async path => ({ displayPath: path, path }),
    stat: async path => (files[path.path ?? path] === undefined ? undefined : { type: 'file' }),
  }
  return captured
}

test('stamping needs no certificate, configured or passed', async () => {
  // The certificate belongs to seal_sign alone. If a credential check ever
  // migrates to a shared path, sealing a document would start demanding a key
  // that has nothing to do with drawing an image.
  const { writeFile, readFile } = await import('node:fs/promises')
  const { mkdtempSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { PDFDocument } = await import('pdf-lib')
  const { deflateSync } = await import('node:zlib')

  const workspace = mkdtempSync(join(tmpdir(), 'seal-nocert-'))
  const pdf = await PDFDocument.create()
  pdf.addPage([595.28, 841.89])
  pdf.addPage([595.28, 841.89])
  const pdfPath = join(workspace, 'doc.pdf')
  await writeFile(pdfPath, await pdf.save())

  // A 2×2 transparent-ish PNG is enough: what is being tested is the absence of
  // a credential requirement, not the drawing.
  const side = 2
  const raw = Buffer.alloc(side * (side * 4 + 1))
  const crc = buffer => {
    let value = 0xffffffff
    for (const byte of buffer) {
      value ^= byte
      for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1
    }
    return (value ^ 0xffffffff) >>> 0
  }
  const chunk = (type, body) => {
    const length = Buffer.alloc(4)
    length.writeUInt32BE(body.length, 0)
    const payload = Buffer.concat([Buffer.from(type), body])
    const check = Buffer.alloc(4)
    check.writeUInt32BE(crc(payload), 0)
    return Buffer.concat([length, payload, check])
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(side, 0)
  header.writeUInt32BE(side, 4)
  header[8] = 8
  header[9] = 6
  const sealPath = join(workspace, 'seal.png')
  await writeFile(sealPath, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]))

  const { ctx, tools } = contextOver({ [pdfPath]: true, [sealPath]: true })
  // Bare config: no p12Path, no passphrase, no sealPath.
  plugin.apply(ctx, new plugin.Config())

  for (const name of ['seal_stamp', 'seal_straddle']) {
    const tool = tools.find(one => one.name === name)
    assert.equal(tool.parameters.p12_path, undefined, `${name} takes no certificate`)
    const output = join(workspace, `${name}.pdf`)
    const value = await tool.execute({ pdf_path: pdfPath, seal_path: sealPath, output_path: output }, { signal: undefined })
    assert.equal(value.output, output)
    assert.ok((await readFile(output)).length > 0, `${name} wrote nothing`)
  }
})

test('a page that is not A4 is called out, since that is why a seal looks wrong', () => {
  // Discovered by testing: a fixture built at 1240x1754 points is 437mm wide,
  // where a correct 40mm seal looks like a speck — and the coordinates in the
  // result look perfectly reasonable.
  assert.equal(plugin.isA4([210, 297]), true)
  assert.equal(plugin.isA4([210.1, 297.1]), true, 'a fraction of a millimetre is still A4')
  assert.equal(plugin.isA4([437, 619]), false)
  assert.equal(plugin.isA4([]), false)
})

/**
 * Drive the credential route the way the client does.
 * @param {Object} route - the registered route spec.
 * @param {string} method - GET, POST or DELETE.
 * @param {Object} [body] - JSON to send.
 * @returns {Promise<Object>} `{ status, value }`
 */
async function callRoute(route, method, body) {
  const chunks = body === undefined ? [] : [Buffer.from(JSON.stringify(body))]
  const request = {
    method,
    url: '/seal/credential',
    async *[Symbol.asyncIterator]() { yield* chunks },
  }
  let status
  let text = ''
  await new Promise(resolve => {
    route.handler(request, {
      writeHead(code) { status = code },
      end(payload) { text = payload ?? ''; resolve() },
    })
  })
  return { status, value: text === '' ? undefined : JSON.parse(text) }
}

test('the client can set, read back and clear the signing credential', async () => {
  const { ctx, tools } = fakeContext()
  const routes = []
  ctx.effect = fn => fn()
  // The route lives inside a nested inject, the way the plugin registers it.
  ctx.inject = (names, body) => {
    if (!names.includes('webServer')) return
    body({ ...ctx, webServer: { register: spec => { routes.push(spec); return () => {} } }, effect: fn => fn() })
  }
  plugin.apply(ctx, new plugin.Config())

  assert.equal(tools.length, 5)
  const route = routes.find(one => one.path === '/seal/credential')
  assert.ok(route, 'the client has no way to configure anything without this route')

  assert.deepEqual((await callRoute(route, 'GET')).value, {
    p12Path: '', hasPassphrase: false, updatedAt: 0, durable: false,
  })

  const saved = await callRoute(route, 'POST', { p12Path: '/keys/company.p12', passphrase: 'secret' })
  assert.equal(saved.status, 200)
  assert.equal(saved.value.p12Path, '/keys/company.p12')
  assert.equal(saved.value.hasPassphrase, true)

  // The read-back must never carry the passphrase — this is the property that
  // keeps it out of browser caches and devtools logs.
  const readBack = await callRoute(route, 'GET')
  assert.equal(JSON.stringify(readBack.value).includes('secret'), false)

  const cleared = await callRoute(route, 'DELETE')
  assert.equal(cleared.value.hasPassphrase, false)
  assert.equal(cleared.value.p12Path, '')
})

test('the route refuses a public certificate and an unknown method', async () => {
  const { ctx } = fakeContext()
  const routes = []
  ctx.effect = fn => fn()
  ctx.inject = (names, body) => {
    if (!names.includes('webServer')) return
    body({ ...ctx, webServer: { register: spec => { routes.push(spec); return () => {} } }, effect: fn => fn() })
  }
  plugin.apply(ctx, new plugin.Config())
  const route = routes[0]

  const refused = await callRoute(route, 'POST', { p12Path: '/keys/company.cer' })
  assert.equal(refused.status, 400)
  assert.match(refused.value.error, /public half/)

  assert.equal((await callRoute(route, 'PUT', {})).status, 405)
})

test('without a web server the tools still work', () => {
  // A profile with no web server (headless, CLI) must still stamp and sign.
  // Declaring webServer at the top level made the entry never activate there,
  // and boot failed with "waiting for service: webServer".
  const { ctx, tools } = fakeContext()
  ctx.inject = () => {}   // nothing provides webServer
  assert.doesNotThrow(() => plugin.apply(ctx, new plugin.Config()))
  assert.deepEqual(tools.map(tool => tool.name).sort(), ['seal_cert', 'seal_sign', 'seal_stamp', 'seal_straddle', 'seal_to_pdf'])
})
