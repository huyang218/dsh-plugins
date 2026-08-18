import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Repo-wide conformance to the spec in CLAUDE.md.
 *
 * These rules were each learned from a failure — a default export that
 * silently dropped `inject`, an unused import that crashed startup under
 * symlink loading, a tool whose cancelled request kept running — and every one
 * of them is invisible in a passing unit test of the plugin itself. Checking
 * them here means a new package cannot quietly skip one.
 */

/**
 * Every plugin package, discovered rather than listed.
 *
 * The layout is one directory per plugin, flat — the ecosystem's scanners look
 * for `packages/<name>/package.json` and nothing in the catalogue of 1,342
 * plugins nests deeper. What a plugin extends is therefore metadata
 * (`dsh.category`), not a parent directory.
 */
function packages() {
  return readdirSync('packages', { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => {
      const dir = join('packages', entry.name)
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
      return { group: String(pkg.dsh?.category ?? '').split('/')[0], dir, pkg }
    })
}

const all = packages()

test('the repo has packages to check', () => {
  assert.ok(all.length >= 1, 'discovery found nothing — the layout changed')
})

for (const { group, dir, pkg } of all) {
  test(`${pkg.name}: names, manifest and layout follow the spec`, async () => {
    const entryPath = join(dir, pkg.main ?? 'lib/index.js')
    const source = readFileSync(entryPath, 'utf8')

    // ── the four names that travel together ──
    assert.match(pkg.name, /^dsh-plugin-/, 'package name carries the prefix')
    const module_ = await import(new URL(`../${entryPath}`, import.meta.url).href)
    assert.ok(!('default' in module_), 'a default export makes the Loader drop `inject`')
    assert.equal(typeof module_.apply, 'function', 'apply must be a named export')
    assert.equal(typeof module_.name, 'string', 'name must be a named export')
    assert.ok(!module_.name.startsWith('dsh-plugin-'),
      'the exported name is the short one; the prefix belongs in package.json')

    assert.equal(dir, join('packages', pkg.name.replace(/^dsh-plugin-/, '')),
      'the directory is the plugin name, one level under packages/, where scanners look')

    const patch = readFileSync(join(dir, 'cordis.patch.yml'), 'utf8')
    assert.match(patch, new RegExp(`name: ${pkg.name}\\b`), 'the patch row references the package by name, not a path')
    assert.match(patch, new RegExp(`id: ${module_.name}\\b`), 'the patch row id matches the exported name')

    // ── open-source packaging ──
    assert.equal(pkg.license, 'MIT')
    assert.ok(!pkg.private, 'a private package cannot be installed from npm')
    assert.ok(pkg.files.includes('cordis.patch.yml'), 'the bundle layer must ship')
    assert.ok(pkg.files.includes('LICENSE'), 'the licence must ship with the package')
    assert.ok(!pkg.files.some(f => /test/.test(f)), 'tests do not ship')
    assert.ok((pkg.keywords ?? []).includes('dsh-plugin'), 'plugin catalogues discover by this keyword')
    assert.equal(pkg.dsh?.bundle?.patch, './cordis.patch.yml')
    assert.match(String(pkg.dsh?.category ?? ''), /^(tools|runtime|ui)\/[a-z-]+$/,
      'dsh.category carries the grouping now that the directories do not')
    assert.equal(pkg.repository?.directory, dir, 'repository.directory points at this package')
    // Both languages, each pointing at the other: the npm page is English and
    // most of this repo's users read Chinese, so one of the two would always
    // be the wrong one to ship alone.
    for (const file of ['README.md', 'README.zh.md']) {
      assert.ok(existsSync(join(dir, file)), `${file} is missing`)
    }
    assert.match(readFileSync(join(dir, 'README.md'), 'utf8'), /\[中文\]\(README\.zh\.md\)/,
      'README.md must link to the Chinese one')
    assert.match(readFileSync(join(dir, 'README.zh.md'), 'utf8'), /\[English\]\(README\.md\)/,
      'README.zh.md must link back')
    assert.ok(pkg.files.includes('README.zh.md'),
      'npm ships README.md automatically but not the translation')

    // ── no dead imports: under symlink loading a stale one is a startup crash ──
    for (const match of source.matchAll(/^import \{([^}]+)\} from '[^']+';?$/gm)) {
      for (const raw of match[1].split(',')) {
        const identifier = raw.trim().split(' as ').pop().trim()
        if (!identifier) continue
        const body = source.replace(match[0], '')
        assert.ok(new RegExp(`\\b${identifier}\\b`).test(body), `unused import: ${identifier}`)
      }
    }
  })

  test(`${pkg.name}: has an entry test asserting the export shape`, () => {
    const testDir = join(dir, 'test')
    assert.ok(existsSync(testDir), 'every package ships tests')
    const suite = readdirSync(testDir).filter(f => f.endsWith('.test.js'))
      .map(f => readFileSync(join(testDir, f), 'utf8')).join('\n')
    assert.match(suite, /'default' in plugin/, 'the default-export regression needs its own guard')
    assert.match(suite, /plugin\.name/, 'the exported name is part of the contract')
  })
}

test('tool plugins keep their canonical values honest', async () => {
  // A closed schema plus `defineTool` running at apply() catches malformed
  // schemas, but only for tools that some test actually constructs.
  for (const { dir, pkg } of all.filter(p => p.group === 'tools')) {
    const module_ = await import(new URL(`../${join(dir, pkg.main)}`, import.meta.url).href)
    const registered = []
    const ctx = {
      tools: { register: t => registered.push(t) },
      systemPrompt: { section() {}, context() {} },
      // A tools/ plugin may also provide a service and reach for another —
      // the vision tool provides its bridge and resolves the sandboxed fs —
      // and a harness missing those fails the plugin for the harness's own gap.
      provide() {}, emit() {}, fs: {}, logger: { warn() {} },
      on() {}, effect: fn => fn(), inject() {},
    }
    module_.apply(ctx, module_.Config ? new module_.Config() : {})
    for (const tool of registered) {
      assert.ok(tool.output?.schema, `${tool.name} declares an output schema`)
      assert.equal(typeof tool.output.render, 'function', `${tool.name} renders model-facing text`)
      assert.ok(tool.timeoutMs > 0, `${tool.name} declares a timeout`)
    }
  }
})

test('a tool whose summary hides rows says so', async () => {
  // Two failures in this repo came from a model treating a truncated summary
  // as the whole answer. A render that shows only part of what it has must
  // say where the rest is, so the model can fetch it instead of extrapolating.
  const listy = {
    astock_financials: { code: 'x', report: 'indicators', count: 30, key: 'periods' },
    astock_moneyflow: { scope: 'stock', code: 'x', count: 30, key: 'rows' },
    astock_convertible_bonds: { tradeDate: '20260814', count: 30, key: 'bonds' },
    ainfo_news: { count: 30, key: 'news' },
    ainfo_research: { count: 30, key: 'reports' },
    ainfo_events: { kind: 'forecast', count: 30, key: 'events' },
  }
  const sample = i => ({
    date: '20260814', period: '20251231', code: '000001', name: 'n' + i, title: 't' + i,
    org: 'o', rating: '买入', holder: 'h', open: 1, high: 2, low: 0.5, close: 1.5,
    volume: 10, netAmount: 1, convPremium: 0.1, convValue: 100, roe: 1,
  })

  for (const { dir, pkg } of all.filter(p => p.group === 'tools')) {
    const module_ = await import(new URL(`../${join(dir, pkg.main)}`, import.meta.url).href)
    const registered = []
    // Stand-ins for whatever a plugin may inject. `inject` mirrors Cordis by
    // running the body only when every named service is available — calling it
    // regardless would hand the plugin an undefined service and fail here for
    // a reason that has nothing to do with the rule under test.
    const services = {
      tushare: { configured: true, access: () => 'points', query: async () => [], tradeDates: async () => ['20260814'] },
      storageDomain: {
        open: async () => ({
          table: () => ({ get: () => undefined, entries: () => [][Symbol.iterator](), size: 0, put: async () => {}, delete: async () => false }),
          close: async () => {},
        }),
      },
    }
    const ctx = {
      tools: { register: t => registered.push(t) },
      systemPrompt: { section() {}, context() {} },
      provide() {}, emit() {}, fs: {}, logger: { warn() {} },
      on() {}, effect: fn => fn(),
      inject: (names, body) => {
        if (!names.every(n => services[n] !== undefined)) return
        body({ ...ctx, ...services, tools: { register: t => registered.push(t) } })
      },
    }
    module_.apply(ctx, module_.Config ? new module_.Config() : {})

    for (const tool of registered) {
      const spec = listy[tool.name]
      if (!spec) continue
      const value = { ...spec, [spec.key]: Array.from({ length: 30 }, (_, i) => sample(i)) }
      const text = tool.output.render({ kind: spec.kind }, value)[0].text
      const shown = text.split('\n').length
      assert.ok(shown < 30, `${tool.name} renders every row; the summary should be bounded`)
      assert.match(text, /规范值|Code Mode|run_code/,
        `${tool.name} truncates its summary without saying where the rest is`)
    }
  }
})

test('both root READMEs account for every category in use', () => {
  // The root README describes the categories rather than listing the
  // plugins, so nothing about it changes when a package is added — which is
  // exactly how it stops being true. A new domain has to be written into the
  // description, in both languages, or it is invisible to a reader.
  const categories = [...new Set(all.map(({ pkg }) => pkg.dsh?.category))].sort()
  for (const file of ['README.md', 'README.zh.md']) {
    const text = readFileSync(file, 'utf8')
    const missing = categories.filter(category => !text.includes(category))
    assert.deepEqual(missing, [], `${file} never mentions: ${missing.join(', ')}`)
  }
})

test('a plugin whose behaviour depends on the presentation mode says so', () => {
  // The mode is picked once per agent preset for the whole session, so a
  // plugin cannot detect or fix a mismatch at runtime — a card just stays
  // empty and nothing errors. Saying which mode it needs is the only
  // mechanism available, which makes leaving it out a real defect.
  for (const { dir, pkg } of all) {
    const projectsMeta = ['lib', 'client']
      .map(sub => join(dir, sub))
      .filter(existsSync)
      .flatMap(sub => readdirSync(sub, { recursive: true }).map(file => join(sub, String(file))))
      .filter(file => file.endsWith('.js'))
      .some(file => readFileSync(file, 'utf8').includes('presentationMeta'))
    const isClient = String(pkg.dsh?.category ?? '').startsWith('ui/')
    if (!projectsMeta && !isClient) continue

    for (const file of ['README.md', 'README.zh.md']) {
      const text = readFileSync(join(dir, file), 'utf8')
      assert.match(text, /presentation|呈现模式|Code Mode/i,
        `${dir}/${file} never says how the tool presentation mode affects it`)
    }
  }
})

test('the root READMEs list every plugin the repo ships', () => {
  // A menu is only useful if it is complete, and nothing about adding a
  // package makes anyone revisit the README — which is exactly how a plugin
  // ends up shipped but unfindable.
  for (const file of ['README.md', 'README.zh.md']) {
    const text = readFileSync(file, 'utf8')
    const missing = all.map(({ pkg }) => pkg.name).filter(name => !text.includes(name))
    assert.deepEqual(missing, [], `${file} does not list: ${missing.join(', ')}`)
  }
})
