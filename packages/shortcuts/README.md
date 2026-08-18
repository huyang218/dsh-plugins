# shortcuts

English · [中文](README.zh.md)

Keyboard shortcuts for the dsh web client. Every reachable feature is registered
in one table: the ones with a sensible default are bound out of the box
(macOS-first — `Ctrl` replaces `⌘` elsewhere), and the rest start unbound for
you to record. Bindings live in the browser's `localStorage`, so they survive a
reload and a restart.

> Vendored from [Ricketts-Guo/dsh-shortcuts](https://github.com/Ricketts-Guo/dsh-shortcuts)
> (MIT, v1.1.4, commit `bf39241`) and maintained here. See
> [what changed](#what-changed-from-upstream).

## Features

| Group | Feature (default binding) |
| --- | --- |
| Session | New session `⌘N` · Session switcher `⌘K` · Archive current `⌘⇧A` · Focus composer `⌘⇧K` · Stop the running task `⌘.` |
| View | Toggle sidebar `⌘B` · Toggle detail panel `⌘⇧D` · Toggle theme `⌘⇧L` · Fullscreen · Scroll to top/bottom · Focus session search |
| Clipboard | Copy the last assistant message · Copy session title · Copy session id |
| Model | Pick model 1–9 `⌘1`–`⌘9` · Reasoning effort 1–5 `Tab+1`–`Tab+5` (hold Tab) · Cycle effort |
| Permission | Cycle permission — read-only / workspace-write / full access `⇧Tab` |
| System | Open settings `⌘,` · Cheatsheet `⌘/` · Cycle interface language |

Features without a default binding start unbound: open **Settings → 快捷键** and
record any combination. The effort steps depend on the current model, and the
permission cycle follows whatever preset table the deployment configures.

> [!NOTE]
> The settings page and cheatsheet are currently labelled in Chinese; the
> feature set and bindings are the same whatever interface language you use.

## Install

```sh
dsh plugin --profile web add dsh-plugin-shortcuts
```

Then restart dsh. A `⌘K 快捷键` button next to the settings button in the
sidebar footer means it loaded.

## Customising

**Settings → 快捷键**:

- **Record** — press any combination to bind it; `Backspace` clears a binding,
  `Esc` cancels recording
- **Enable/disable** per feature, and **restore defaults** in one click
- **Conflict detection** refuses a combination that is already bound
- Model and effort rows show the name each position currently resolves to

The cheatsheet (`⌘/`) ends with a diagnostic panel — current session id, `⇧Tab`
binding state, whether the permission service is reachable, the last permission
switch and its outcome, and the last 12 keypresses with whether the plugin
claimed them. It is there so you can tell "not bound" from "bound but the
service is missing" without opening devtools.

## How it works

One `FEATURES` table drives everything — the settings page, the cheatsheet,
conflict detection, persistence and key dispatch are all derived from it, so a
new feature is one entry:

```js
{ id: 'stopTask', group: '会话', label: '停止当前任务',
  description: '中断正在运行的 agent 回合', defaultCombo: 'Meta+.',
  run: () => { /* any client-side logic */ } }
```

Actions go through the official client services (`layout`, `workspaces`,
`theme`, `locale`, `sessions`, `modelDirectories`, session projections) rather
than private DOM structure — only "open settings" locates its trigger by a
semantic attribute.

`Tab+<digit>` is recognised by tracking whether Tab is held, which keeps a bare
Tab working for normal focus navigation.

**Why the plugin has a host half.** The official permission switcher routes
through the `/permission` slash command, whose lifecycle is durably logged as
command nodes — cycling permissions with a hotkey would spam the transcript.
The host half exposes a loopback route that writes through the same
`permissionPresets` service the command handler uses, minus the transcript
noise. The route validates the session id against the live session store and
lets `permissionPresets.set` reject an unknown preset, and it is not mounted at
all unless the deployment provides the permission service. dsh's web server
binds to loopback; keep it that way.

**Presentation mode.** This plugin extends the web client, so it is unaffected
by whether tools are dispatched natively or through Code Mode.

## What changed from upstream

- Package renamed to `dsh-plugin-shortcuts` for this repository's naming
  convention, which also changes the client bundle's loader id (it must match
  the package name) and the plugin row in `cordis.patch.yml`
- Added the `name` export the loader uses for diagnostics
- Added `dsh.category`, `repository.directory` and this bilingual README pair
- Replaced the `install.sh` bootstrap and its shell test with the standard
  `dsh plugin add` install
- Tests rewritten on `node:test`: upstream drove a DOM sandbox and resolved
  React through a locally installed dsh, which made them unrunnable anywhere
  else. The key-resolution helpers are exported from the bundle and asserted
  directly, and the shipped artifact itself is loaded through a fake module
  loader.

Upstream's copyright and MIT licence are kept in [LICENSE](LICENSE).

## Licence

MIT — see [LICENSE](LICENSE).
