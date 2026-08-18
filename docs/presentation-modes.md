# Tool presentation modes

English · [中文](presentation-modes.zh.md)

How a session dispatches tools — natively, through Code Mode, or both — is
chosen **once per agent preset and applies to every tool in that session**. No
plugin selects it, and no plugin can opt out of it. This page exists because
the choice is easy to make for one plugin and then quietly change how all the
others behave.

## The three modes

| Mode | What the model may call | Prompt sections added |
| --- | --- | --- |
| `native` | every tool, one call per action | none |
| `code` | only `run_code`, which dispatches tools inside a TypeScript program | the generated SDK, plus the rule that only `run_code` may be called |
| `both` | either, chosen per call | the generated SDK |

`both` deliberately does not carry the "only `run_code`" rule: native calls
really do execute there, so the rule would be false.

A preset declares its mode with one `tool-presentation` row:

```yaml
- id: tool-presentation
  name: '@deepseek-ai/dsh-agent-tool-presentation'
  config:
    mode: both
```

The declaration attaches to the preset's scope and covers every agent joined to
it — one composition selects one presentation, and a second declaration in the
same scope is rejected at mount. `code` and `both` also require a TypeScript
code runtime on the host; a preset selecting them without one fails at mount,
naming the row, rather than at the first prompt.

## What each mode costs

**`native` breaks tools whose product is data, not prose.** A whole-market
screening tool returns hundreds of thousands of rows as its canonical value and
deliberately renders only a summary — several thousand lines must never enter
the model's context. Called natively, the model receives the summary and
nothing else. It does not necessarily say so: the failure that led to this page
was a model that went and decompressed session logs, wrote a fabricated data
file, and answered confidently from it.

**`code` breaks UI cards.** A tool call dispatched inside `run_code` carries no
result metadata — code-dispatch events carry only `content` and `isError` — so
`output.presentationMeta` is never projected and a card keyed on that tool name
never receives data. Nothing errors; the card is simply always empty. This is
why any plugin that draws a card has to say in its README that it needs
`native` or `both`.

**`both` reopens the `native` hole.** The model picks per call, so it *can*
call a summary-only tool natively and get no data. A tool in that shape must
refuse the native route itself — `exec.parent` is set only for a `run_code`
sub-call, so its absence is the signal — and the error must say to use
`run_code`, and to report the failure rather than piece an answer together.

## It is session-wide, not per plugin

Consequences that catch people out:

- **Every tool plugin is affected, including ones installed later.** A mode
  chosen to make a chart render also decides how a third-party tool you install
  next month is dispatched.
- **Measurement plugins see the sub-calls too.** `tools/execute` and
  `tools/result` both fire for calls dispatched inside `run_code`, so a metrics
  plugin that adds up every call double-counts under `code` and `both` — the
  `run_code` wrapper's duration already contains the work it dispatched. Split
  top-level from nested by `exec.parent`.
- **Code Mode costs prompt budget on every request.** The generated SDK
  section describes the whole catalog in SDK form, in addition to the tool
  definitions.
- **Cards are absent, not broken.** There is no error to find in a log. If a
  card is empty under `code`, that is the expected behaviour of the mode.

## What this means for plugin authors

- If a plugin depends on `presentationMeta` — any card — **state the required
  mode in its README**. It cannot detect or fix this at runtime.
- If a tool's canonical value is the product and its `render` is a summary,
  **refuse a native dispatch** and name `run_code` in the error. Do not add this
  guard to single-subject query tools, whose render is the whole answer.
- **Do not ship a preset with a plugin.** The mode is a deployment decision
  covering everything a session can call; a plugin that changed it would be
  changing behaviour it does not own. Document the requirement instead.

## Choosing a mode for a deployment

Presets ship with dsh under `config/agent-presets/`. To run a variant, copy one
into `$DSH_HOME/.agent-presets/<name>/`, edit its `tool-presentation` row, and
select it:

```yaml
# $DSH_HOME/profiles/<profile>/cordis.patch.yml
- id: agent-presets
  config:
    default: <name>
```

The shipped `standard` preset is `native` and `code` is Code Mode; a copy of
`code` differing only in `mode: both` is what a deployment needs when it runs
both a screening workload and a card-drawing plugin in the same session.
Restart the service for a preset change to take effect.
