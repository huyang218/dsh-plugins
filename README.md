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

| Plugin | Group | What it does | Credentials |
| --- | --- | --- | --- |
| [**astock**](packages/astock) | [`tools`](docs/authoring-tools.md) | A-share market data: quotes, K-lines, indicators, whole-market screening, financial statements, money flow, convertible bonds | free, plus Tushare-only tools |
| [**ainfo**](packages/ainfo) | [`tools`](docs/authoring-tools.md) | A-share information: news, broker research, earnings pre-announcements, dividends, insider trades, shareholders | Tushare token |
| [**astock-chart**](packages/astock-chart) | [`ui`](docs/authoring-ui.md) | Renders `astock_data` results as a candlestick chart with volume, inside the reply | — |
| [**tushare**](packages/tushare) | [`runtime`](docs/authoring-runtime.md) | Shared Tushare Pro access: one token, one quota gate, one calendar, and failures an agent can act on | — |
| [**tool-health**](packages/tool-health) | [`runtime`](docs/authoring-runtime.md) | Remembers which tools have been failing, across sessions, and tells the next session before it starts work | — |
| [**tool-usage**](packages/tool-usage) | [`runtime`](docs/authoring-runtime.md) | Measures what a session spends on tools — calls, duration percentiles, failures — with an optional budget warning | — |
| [**gateway-compat**](packages/gateway-compat) | [`runtime`](docs/authoring-runtime.md) | Keeps a completed reply from failing when an OpenAI-style gateway ends its SSE stream without the `[DONE]` sentinel | — |

> [!NOTE]
> Finance plugins share one credential through the `tushare` provider rather
> than each asking for the same token. Every tool that needs it says so **in its
> own description**, so the model can choose a free tool when one will do — and
> tell you exactly what is missing when one will not.

### Groups

Every plugin sits directly in `packages/<name>/`, because that is where the
ecosystem's scanners look — nothing in the catalogue of 1,342 plugins nests
deeper. What a plugin extends is declared as metadata (`dsh.category`) rather
than by a parent directory:

| `dsh.category` | Holds | Visible to the model | Conventions |
| --- | --- | :---: | --- |
| `tools/…` | Capabilities the model can call | yes | [authoring-tools](docs/authoring-tools.md) |
| `runtime/…` | Waterfall wrappers and shared services | no | [authoring-runtime](docs/authoring-runtime.md) |
| `ui/…` | Web client extensions | in the browser | [authoring-ui](docs/authoring-ui.md) |

## Why the layout

The directory tree is flat because the ecosystem reads it: plugin catalogues
and in-app markets look for `packages/<name>/package.json`, and a repo that
nests deeper is not found at all.

The grouping still matters — it is what decides how a plugin is written,
reviewed and tested — so it lives in `dsh.category` instead:

- a **tools** plugin registers tools, is visible to the model, and lives or
  dies by its output schema;
- a **runtime** plugin listens on waterfall extension points or provides a
  shared service, is invisible to the model, and must never turn a real
  failure into a fake success;
- a **ui** plugin ships a client bundle the web client loads.

Subject matter (finance, devtools, …) lives in the package name and its README,
so a plugin never has to be filed twice.

Each group has its own README with the conventions and pitfalls for that shape.

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

1. Pick the group that matches the extension shape and read its guide in `docs/`.
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
