# dsh-plugins

English | [中文](README.zh.md)

Plugins for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)
(dsh) — the "everything is a plugin" agent runtime built on Cordis.

Every package here is an installable dsh **bundle**: pure ESM with no build
step, so it runs from npm, from git, or straight from a checkout while you
edit it.

## Plugins

### [`packages/tools/`](packages/tools) — capabilities the model can call

| Plugin | What it does |
| --- | --- |
| [`astock`](packages/tools/astock) | A-share market data: quotes, K-lines, technical indicators, and whole-market batch tools for screening thousands of stocks in one call |

### [`packages/runtime/`](packages/runtime) — how the harness itself behaves

| Plugin | What it does |
| --- | --- |
| [`gateway-compat`](packages/runtime/gateway-compat) | Keeps a completed reply from failing when an OpenAI-style gateway ends its SSE stream without the `[DONE]` sentinel |

### [`packages/ui/`](packages/ui) — web client extensions

Empty for now.

## Why the layout

The top level splits by **extension shape** — what a plugin does to the harness
— because that is what decides how it is written, reviewed and tested:

- a **tools** plugin registers tools, is visible to the model, and lives or
  dies by its output schema;
- a **runtime** plugin listens on waterfall extension points, is invisible to
  the model, and must never turn a real failure into a fake success;
- a **ui** plugin ships a client bundle and usually needs a build.

Subject matter (finance, devtools, …) lives in the package name and its README,
not in the directory tree, so a plugin never has to be filed twice.

Each group has its own README with the conventions and pitfalls for that shape.

## Install

Into a dsh profile, from npm:

```sh
dsh plugin --profile web add dsh-plugin-astock
```

Or from a checkout — also how you develop against a running profile, since the
install is a symlink and edits take effect on the next service restart:

```sh
dsh plugin --profile web add ./packages/tools/astock
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

Later layers win per row, and a patch **replaces a row's whole `config`** rather
than merging keys — so restate every key you need when overriding someone
else's row.

## Develop

```sh
npm install                                        # root; resolves peer deps for every package
npm test                                           # every package
npm test -w dsh-plugin-astock                      # one package
node --test packages/tools/astock/test/*.test.js   # one file
```

Tests use Node's built-in runner (`node:test`) — no test dependencies, no build,
matching the way the plugins themselves load. They exercise the real published
entry (`lib/index.js`) and the real `defineTool`, so a schema violation fails in
unit tests instead of at dsh startup.

Green tests are not the whole bar. [CLAUDE.md](CLAUDE.md) carries the full
working spec — plugin lifecycle, config, tool authoring, waterfall extension
points, bundle layering, the test convention, and the verification checklist to
run after changing a plugin. It is addressed to AI coding agents, but the rules
are the same ones a human contributor needs.

## Contributing

1. Pick the group that matches the extension shape and read its README.
2. Create `packages/<group>/<name>/` with `package.json`, `cordis.patch.yml`,
   `lib/index.js`, `README.md` and `LICENSE`.
3. Export `name` / `inject` / `apply` as **named** exports. A default export
   makes the loader drop `inject`, and the plugin then fails in a way that
   looks like something else entirely.
4. Add `test/plugin.test.js` covering the export shape and every registration.
5. Run `npm test` and the checklist in CLAUDE.md.

Three names travel together and are easy to confuse:

| Where | Value | Purpose |
| --- | --- | --- |
| `package.json` `name` | `dsh-plugin-astock` | npm package |
| `lib/index.js` exported `name` | `astock` | loader diagnostics — short, no prefix |
| `cordis.patch.yml` `id` | `astock` | row id in the composed tree; config overrides target it |
| `cordis.patch.yml` `name` | `dsh-plugin-astock` | referenced by package name, never a path |

## License

MIT — see [LICENSE](LICENSE).
