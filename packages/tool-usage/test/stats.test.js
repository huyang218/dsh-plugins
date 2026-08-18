import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fold, percentile, summarize, duration, renderSummary, renderBudgetWarning } from '../lib/stats.js'

test('fold accumulates calls, failures, total and max', () => {
  let stat = fold(undefined, { ms: 100, ok: true })
  stat = fold(stat, { ms: 300, ok: false })
  assert.equal(stat.calls, 2)
  assert.equal(stat.failures, 1)
  assert.equal(stat.totalMs, 400)
  assert.equal(stat.maxMs, 300)
  assert.deepEqual(stat.samples, [100, 300])
})

test('fold treats a missing or negative duration as zero rather than poisoning the totals', () => {
  const stat = fold(fold(undefined, { ms: undefined, ok: true }), { ms: -5, ok: true })
  assert.equal(stat.totalMs, 0)
  assert.ok(Number.isFinite(stat.maxMs))
})

test('fold keeps only the most recent samples', () => {
  let stat
  for (let i = 0; i < 10; i++) stat = fold(stat, { ms: i, ok: true }, 4)
  // Percentiles describe how the tool behaves now; keeping every duration ever
  // measured lets an hour-old cold start drag them forever.
  assert.deepEqual(stat.samples, [6, 7, 8, 9])
  assert.equal(stat.calls, 10, 'the call count is still complete')
})

test('percentile uses nearest rank and tolerates an empty sample', () => {
  assert.equal(percentile([10, 20, 30, 40], 0.5), 20)
  assert.equal(percentile([10, 20, 30, 40], 0.95), 40)
  assert.equal(percentile([7], 0.95), 7)
  assert.equal(percentile([], 0.95), undefined)
  assert.equal(percentile(undefined, 0.5), undefined)
})

test('summarize sorts by total time, not by call count', () => {
  const stats = new Map([
    ['chatty', fold(undefined, { ms: 1, ok: true })],
    ['heavy', fold(undefined, { ms: 12_000, ok: true })],
  ])
  for (let i = 0; i < 40; i++) stats.set('chatty', fold(stats.get('chatty'), { ms: 1, ok: true }))
  const summary = summarize(stats)
  // The tool worth looking at is where the wall clock went.
  assert.equal(summary.tools[0].name, 'heavy')
  assert.equal(summary.calls, 42)
  assert.equal(summary.totalMs, 12_041)
})

test('duration shortens as it grows', () => {
  assert.equal(duration(320), '320ms')
  assert.equal(duration(4200), '4.2s')
  assert.equal(duration(125_000), '2m5s')
})

test('renderSummary lists the heaviest tools and says when there are more', () => {
  const stats = new Map()
  for (const [name, ms] of [['a', 5000], ['b', 3000], ['c', 1000]]) {
    stats.set(name, fold(undefined, { ms, ok: true }))
  }
  stats.set('b', fold(stats.get('b'), { ms: 100, ok: false }))
  const text = renderSummary(stats, { topN: 2 })
  assert.match(text, /4 calls, 1 failed/)
  assert.match(text, /a: 1×/)
  assert.match(text, /\(1 failed\)/)
  assert.match(text, /and 1 more tools/)
  assert.equal(renderSummary(new Map()), 'No tool calls yet.')
})

test('the budget warning stays silent under budget and suggests technique over it', () => {
  const stats = new Map([['astock_market_bars', fold(undefined, { ms: 30_000, ok: true })]])
  assert.equal(renderBudgetWarning(stats, { calls: 0, seconds: 0 }), '', 'disabled by default')
  assert.equal(renderBudgetWarning(stats, { calls: 10, seconds: 0 }), '', 'under the call budget')

  const text = renderBudgetWarning(stats, { calls: 1, seconds: 0 })
  assert.match(text, /astock_market_bars/, 'name where the time went')
  // "You are slow" with no suggestion just makes a model apologise and carry on.
  assert.match(text, /one batch call over many per-item calls/)

  assert.match(renderBudgetWarning(stats, { calls: 0, seconds: 20 }), /30\.0s/, 'the time budget alone can trip it')
})

test('a nested call is counted for its tool but not for the session clock', () => {
  // Under Code Mode a run_code call CONTAINS the tools it dispatched, so
  // summing every row double-counts the wall clock. Measured before this
  // split: 204ms reported for 100ms actually spent, which also tripped a
  // budget the session never crossed.
  const stats = new Map([
    ['run_code', fold(undefined, { ms: 100, ok: true })],
    ['astock_market_bars', fold(undefined, { ms: 60, ok: true, nested: true })],
    ['astock_quote', fold(undefined, { ms: 40, ok: true, nested: true })],
  ])
  const summary = summarize(stats)
  assert.equal(summary.totalMs, 100, 'the session clock counts only what the model dispatched')
  assert.equal(summary.calls, 3, 'every call is still counted')
  assert.equal(summary.nestedCalls, 2)

  const bars = summary.tools.find(t => t.name === 'astock_market_bars')
  assert.equal(bars.totalMs, 60, 'the tool still owns its own duration')
  assert.equal(bars.nestedCalls, 1)

  const text = renderSummary(stats)
  assert.match(text, /not counted twice/, 'the report must explain the difference')
  assert.match(text, /\(1 nested\)/)
})

test('the budget warning names the tool that did the work, not the transport', () => {
  const stats = new Map([
    ['run_code', fold(undefined, { ms: 30_000, ok: true })],
    ['astock_market_bars', fold(undefined, { ms: 29_000, ok: true, nested: true })],
  ])
  const text = renderBudgetWarning(stats, { seconds: 10 })
  // "Most of it is run_code" tells the model nothing it can act on.
  assert.match(text, /astock_market_bars/)
  assert.ok(!/Most of it is run_code/.test(text))
  // And the threshold is measured against wall clock, not the doubled total.
  assert.equal(renderBudgetWarning(stats, { seconds: 40 }), '', '30s of wall clock is under a 40s budget')
})
