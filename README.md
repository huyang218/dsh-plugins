# dsh-plugins

English | [中文](README.zh.md)

Plugins for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)
(dsh), the "everything is a plugin" agent runtime built on Cordis.

Every package here is an installable dsh **bundle**: build-free, pure ESM, no
compile step, so it installs straight from npm or git.

## Plugins

### `packages/tools/` — capabilities the model can call

| Plugin | What it does |
| --- | --- |
| [`astock`](packages/tools/astock) | A-share quotes, K-lines, technical indicators, and whole-market batch tools for screening |

### `packages/runtime/` — how the harness itself behaves

| Plugin | What it does |
| --- | --- |
| [`gateway-compat`](packages/runtime/gateway-compat) | Tolerates OpenAI-style gateways whose SSE stream ends without `[DONE]` |

### `packages/ui/` — web client extensions

Empty for now.

The top level splits by **extension shape**, because that is what decides how a
plugin is written and reviewed: a tools plugin registers tools and is visible to
the model; a runtime plugin listens on waterfall extension points and is not.
Domain lives in the package name and its README.

## Install

```sh
dsh plugin --profile web add dsh-plugin-astock
```

Or from a checkout, which is also how you develop against a live profile:

```sh
dsh plugin --profile web add ./packages/tools/astock
```

Plugins that expose a Schemastery `Config` are configurable from your shell's
plugin settings — no command line required for end users.

## Develop

```sh
npm install          # root install; resolves peer deps for linked packages
npm test             # every package
npm test -w dsh-plugin-astock
node --test packages/tools/astock/test/indicators.test.js
```

Tests use Node's built-in runner (`node:test`), so there are no test
dependencies and nothing to build.

[CLAUDE.md](CLAUDE.md) is the working spec for this repo: plugin lifecycle,
config, tool authoring rules, waterfall extension points, bundle layering, the
test convention, and the post-change verification checklist. It is written for
AI coding agents but is the same set of rules a human contributor needs.

### Adding a plugin

1. Create `packages/<tools|runtime|ui>/<name>/` with `package.json`
   (`"name": "dsh-plugin-<name>"`, `"type": "module"`, `main` → `lib/index.js`),
   `cordis.patch.yml`, and `lib/index.js`.
2. Declare the bundle: `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }`,
   and list `lib`, `cordis.patch.yml`, `LICENSE` in `files`.
3. Export `name` / `inject` / `apply` as **named** exports — never a default
   export, which makes the loader drop `inject`.
4. Add `test/plugin.test.js` asserting the export shape and the registrations.

## License

MIT — see [LICENSE](LICENSE).
