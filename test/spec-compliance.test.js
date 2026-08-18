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
    assert.ok(existsSync(join(dir, 'README.md')), 'a package README is its npm page')

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
    const service = { configured: true, access: () => 'points', query: async () => [], tradeDates: async () => ['20260814'] }
    const ctx = {
      tools: { register: t => registered.push(t) },
      systemPrompt: { section() {}, context() {} },
      on() {}, effect: fn => fn(),
      inject: (names, body) => body({ ...ctx, tushare: service, tools: { register: t => registered.push(t) } }),
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
