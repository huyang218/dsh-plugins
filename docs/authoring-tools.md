# `tools/`

> Plugins that give the model **new capabilities**. They call
> `ctx.tools.register(defineTool(...))`, so their tools appear in the model's
> schema list and the model decides when to call them.

## Plugins in this group

| Plugin | Covers | Needs credentials |
| --- | --- | --- |
| [**astock**](../packages/astock) | A-share **data**: quotes, K-lines, indicators, whole-market screening, financial statements, money flow, convertible bonds | Free by default; a [Tushare Pro](https://tushare.pro) token unlocks the rest |
| [**ainfo**](../packages/ainfo) | A-share **information**: news, broker research, earnings pre-announcements, dividends, insider trades, shareholders | Tushare token for everything |

## What a tool owes its caller

A tool is a **programmatic API that a model happens to call**, so design its
output the way you would design a function's return value, not a paragraph.

- **`execute` returns the canonical JSON value declared by `output.schema`** —
  ids and fields, ready to use. Never make the caller parse prose. In Code Mode
  the model receives exactly this value from `await tools.<name>(args)`.
- **`output.render(args, value)` is the model-facing text**, derived from that
  same value. It explains; it is not the data channel.
- **Every `type: 'object'` node must state `additionalProperties: true|false`.**
  `defineTool` throws at definition time otherwise, taking the whole plugin
  tree down at startup.
- **Missing data is an absent key** — never `0`, never `NaN`. Providers spell
  absence differently (`'-'`, `null`, `''`), and `Number(null)` is `0`, which
  silently turns "no P/E" into "P/E of zero". A `NaN` makes the entire call
  `isError` under a closed schema.
- **Throw for infrastructure failures**; a domain result that is merely
  unwelcome (no matches, non-zero exit) belongs in the canonical value, with
  `render` explaining it.
- **Honour `exec.signal`**, treat `args` as read-only, and give every tool a
  `timeoutMs`.
- **Card presenters (`presentCall` / `presentResult`) must be pure** — they run
  again during session replay, so no I/O, no clock, no randomness. Facts known
  only at result time go through `output.presentationMeta`.
- **Ship a `ctx.systemPrompt.section` per tool** saying when to reach for it.
  A tool the model never thinks to call may as well not exist.

## Bulk tools: scan inside the tool

Anything that answers "which of all N stocks/rows/items satisfy X" must sweep
the dataset **inside** `execute`. Making the model loop over thousands of
single-item calls does not merely cost context — upstream providers throttle it
and the run dies half-finished.

Two rules follow, both learned the hard way (see
[`astock`](../packages/astock) and the notes in [CLAUDE.md](../CLAUDE.md)):

- **`render` returns a summary only.** Thousands of rows must never enter the
  model's context as text. The rows live in the canonical value, which the
  model reaches from a `run_code` program — so say so in the summary, and say
  that a caller who cannot reach it must report that rather than guess.
- **Pack large results.** Every binding value crosses the Code Mode worker
  boundary, where each array is validated and rebuilt under a heap cap; hundreds
  of thousands of small objects will abort the host process. Pack them into
  strings (shared references cross almost free) and budget the size, refusing an
  over-budget request up front instead of fetching it first.

## Adding a tools plugin

1. `mkdir packages/tools/<name>` with `package.json`, `cordis.patch.yml`,
   `lib/index.js`, `README.md`, `LICENSE`.
2. `export const name`, `inject = ['tools', 'systemPrompt']`, and `apply` as
   **named** exports — a default export makes the loader drop `inject`.
3. Keep fetching/parsing in their own modules; `lib/index.js` should read as
   registration plus formatting.
4. Add `test/plugin.test.js`: assert the export shape, then call `apply` with a
   fake ctx and assert every tool and prompt section registers. The real
   `defineTool` runs there, so schema violations fail in unit tests rather than
   at dsh startup.

Full rules: the "工具(defineTool)" section of [CLAUDE.md](../CLAUDE.md).
