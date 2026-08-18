<div align="center">

# dsh-plugins

**Plugins for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)** — the
"everything is a plugin" agent runtime built on Cordis.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Build-free ESM](https://img.shields.io/badge/build-none-brightgreen.svg)](#develop)
[![Tests: node:test](https://img.shields.io/badge/tests-node%3Atest-informational.svg)](#develop)

English · [中文](README.zh.md)

</div>

---

Every package here is an installable dsh **bundle**: pure ESM, no build step, so
it runs from npm, from git, or straight from a checkout while you edit it.

## Plugins

Three kinds, told apart by `dsh.category` in each package — what a plugin
extends decides where it can be seen from:

| Group | Visible to | What it extends | Guide |
| --- | --- | --- | --- |
| `tools/…` | the model | capabilities it can call, described in the system prompt | [authoring tools](docs/authoring-tools.md) |
| `runtime/…` | nobody | waterfall wrappers and shared services around the harness itself | [authoring runtime](docs/authoring-runtime.md) |
| `ui/…` | the person | web client extensions — result cards, keyboard-driven surfaces | [authoring ui](docs/authoring-ui.md) |

The second half of the category is the domain: `tools/finance` and `ui/finance`
cover A-share market data, information feeds and portfolio state; `tools/vision`
reaches a multimodal model on behalf of a text-only one;
`runtime/provider`, `runtime/observability`, `runtime/reliability` and
`runtime/llm` cover shared credentials, measurement, retries and gateway
compatibility; `ui/productivity` covers the web client's own ergonomics.

### Pick what you need

**`tools/` — capabilities the model can call**

| Plugin | What it does | Package |
| --- | --- | --- |
| [astock](packages/astock) | A-share quotes, K-lines, indicators, whole-market screening, financials, money flow, convertible bonds — free, a few tools need a Tushare token | `dsh-plugin-astock` |
| [vision](packages/vision) | Lets a text-only agent call a multimodal model mid-task: one image file to an OpenAI-compatible vision endpoint, back as structured evidence — needs an endpoint, not a key | `dsh-plugin-vision` |
| [ainfo](packages/ainfo) | A-share news, broker research, earnings pre-announcements, dividends, insider trades, shareholders — needs a Tushare token | `dsh-plugin-ainfo` |
| [aportfolio](packages/aportfolio) | Holdings and watchlist that survive the session, priced live, with profit, weights and target hits | `dsh-plugin-aportfolio` |

**`runtime/` — behaviour around the harness, invisible to the model**

| Plugin | What it does | Package |
| --- | --- | --- |
| [tushare](packages/tushare) | Shared Tushare Pro access: one token, one quota gate, one calendar, failures an agent can act on | `dsh-plugin-tushare` |
| [tool-health](packages/tool-health) | Remembers which tools keep failing and warns the next session before it starts | `dsh-plugin-tool-health` |
| [tool-usage](packages/tool-usage) | Counts calls, duration percentiles and failures per tool, with an optional budget warning | `dsh-plugin-tool-usage` |
| [tool-retry](packages/tool-retry) | Retries transient failures — socket resets, rate limits, timeouts — for tools an operator declares repeatable | `dsh-plugin-tool-retry` |
| [gateway-compat](packages/gateway-compat) | Keeps a finished reply from failing when a gateway ends its SSE stream without `[DONE]` | `dsh-plugin-gateway-compat` |

**`ui/` — web client extensions**

| Plugin | What it does | Package |
| --- | --- | --- |
| [astock-chart](packages/astock-chart) | Draws `astock_data` as a candlestick chart with volume, in the reply — needs `native` or `both` presentation | `dsh-plugin-astock-chart` |
| [shortcuts](packages/shortcuts) | Keyboard shortcuts for the web client: 34 features, every binding recordable | `dsh-plugin-shortcuts` |

Each plugin's own README, in English and 中文, is the accurate account of what
it does and what it costs to run. Install any of them by package name:

```sh
dsh plugin --profile web add dsh-plugin-astock
```

**Looking for something this repo does not ship?** [CATALOG.md](CATALOG.md)
lists plugins maintained elsewhere, by category.

> [!NOTE]
> Finance plugins share one credential through the `tushare` provider rather
> than each asking for the same token. Every tool that needs it says so **in its
> own description**, so the model can choose a free tool when one will do — and
> tell you exactly what is missing when one will not.

## Install

Into a dsh profile, from npm:

```sh
dsh plugin --profile web add dsh-plugin-astock
```

Or from a checkout — also how you develop against a running profile, since the
install is a symlink and edits take effect on the next service restart:

```sh
dsh plugin --profile web add ./packages/astock
```

Verify it landed in the composed tree before starting anything:

```sh
dsh --profile web --dump-config      # look for the plugin's row
```

## Configure

A plugin that exposes a Schemastery `Config` is configurable without touching a
command line: a desktop shell renders the form at install time. The values end
up as an id-targeted override in the profile's `cordis.patch.yml`, which you can
also write by hand:

```yaml
- id: astock
  config:
    tushareToken: 'your-token'
```

> [!IMPORTANT]
> Later layers win per row, and a patch **replaces a row's whole `config`**
> rather than merging keys — so restate every key you need when overriding
> someone else's row.

**Tool presentation** — whether a session dispatches tools natively, through
Code Mode, or both — is chosen once per agent preset and applies to every tool
in the session, not per plugin. Some plugins here require a particular mode,
and the choice affects every other plugin you install:
[tool presentation modes](docs/presentation-modes.md).

## Develop

```sh
npm install                                        # root; resolves peer deps for every package
npm test                                           # every package
npm test -w dsh-plugin-astock                      # one package
node --test packages/astock/test/*.test.js   # one file
```

Tests use Node's built-in runner (`node:test`) — no test dependencies, no build,
matching the way the plugins themselves load. They exercise the real published
entry (`lib/index.js`) and the real `defineTool`, so a schema violation fails in
unit tests instead of at dsh startup.

> [!TIP]
> Green tests are not the whole bar — they never touch the Loader or a real
> composition.

[CLAUDE.md](CLAUDE.md) carries the full working spec — plugin lifecycle, config, tool authoring, waterfall extension
points, bundle layering, the test convention, and the verification checklist to
run after changing a plugin. It is addressed to AI coding agents, but the rules
are the same ones a human contributor needs.

## Contributing

1. Read the guide for what you are building: [tools](docs/authoring-tools.md)
   (capabilities the model calls), [runtime](docs/authoring-runtime.md)
   (waterfall wrappers and shared services) or [ui](docs/authoring-ui.md)
   (web client extensions).
2. Create `packages/<name>/` with `package.json` (including `dsh.category`),
   `cordis.patch.yml`, `lib/index.js`, `README.md` and `LICENSE`.
3. Export `name` / `inject` / `apply` as **named** exports. A default export
   makes the loader drop `inject`, and the plugin then fails in a way that
   looks like something else entirely.
4. Add `test/plugin.test.js` covering the export shape and every registration.
5. Run `npm test` and the checklist in CLAUDE.md.

Four names travel together and are easy to confuse:

| Where | Value | Purpose |
| --- | --- | --- |
| `package.json` `name` | `dsh-plugin-astock` | npm package |
| `lib/index.js` exported `name` | `astock` | loader diagnostics — short, no prefix |
| `cordis.patch.yml` `id` | `astock` | row id in the composed tree; config overrides target it |
| `cordis.patch.yml` `name` | `dsh-plugin-astock` | referenced by package name, never a path |

## License

MIT — see [LICENSE](LICENSE).
