# Plugin catalogue

English | [中文](CATALOG.zh.md)

Plugins worth knowing that are **not** in this repo — maintained by their own
authors, installed from their own repositories. The plugins this repo ships and
maintains are in the [README](README.md).

Everything here was checked against its repository, and each entry says what
the plugin does rather than how good it is. A licence column is filled only
where it was verified; `—` means it was not checked, not that there is none.
Star counts are a snapshot from 2026-08-18.

### Web UI

| Plugin | ★ | What it does | Licence |
| --- | --: | --- | --- |
| [DSH-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar) | 2026 | Full sidebar workbench with file rendering and editing, terminal, Git, and subagents; third-party plugins can register new tabs. | — |
| [dsh-at-file](https://github.com/omdsh-dev/dsh-at-file) | 347 | Codex-style `@file` mentions: search workspace files in the composer and attach their contents to prompts. | MIT |
| [dsh-auto-collapse](https://github.com/a179-sanae/dsh-auto-collapse) | 24 | Codex-style workflow auto-collapse: finished turns fold into a single "processed in Xs" row leaving only the final answer; tool calls and think blocks | MIT |
| [dsh-annotation](https://github.com/omdsh-dev/dsh-annotation) | 72 | Select text → annotate → send with your message; replies map back to each annotation. | — |
| [dsh-navbar](https://github.com/vlln/dsh-navbar) | 38 | Conversation node navigation bar for quick jumps between user messages. | — |
| [dsh-shortcuts](https://github.com/Ricketts-Guo/dsh-shortcuts) | 2 | Fully customizable keyboard shortcuts for the Web UI: 34 pre-registered features (sessions, views, clipboard, models, silent permission cycling, setti | MIT |
| [ui-status-label](https://github.com/alingalingling/ui-status-label) | 38 | Customize the "deep diving" thinking status label to anything you like. | MIT |

### Observability & sessions

| Plugin | ★ | What it does | Licence |
| --- | --: | --- | --- |
| [dsh-context](https://github.com/bowenliang123/dsh-context) | 234 | DSH context insight panel: Context dashboard + /context command + Context browser — one-stop context lifecycle management with categorized composition | Apache-2.0 |
| [dsh-heatmap](https://github.com/283Gawin/dsh-heatmap) | 3 | Activity heatmap in the DSH Web sidebar: GitHub-style grid of daily commits, token usage, and estimated spend, with a today stats line for all-session | MIT |
| [dsh-whale-report](https://github.com/SenmuuuuW/dsh-whale-report) | 22 | DeepTrace — deterministic agent reports from session logs (daily/weekly/monthly/yearly/custom): cost & token breakdown, 8 insight rules, collaboration | — |
| [dsh-session-doctor](https://github.com/mayf3/dsh-session-doctor) | 2 | Diagnose, unstick, and read DSH sessions: list sessions with agent status, read conversations, diagnose stuck agents, recover them with cancel+keepInb | — |
| [dsh-backup](https://github.com/xiaoyuyu6420/dsh-backup) | 3 | One-command backup & restore of DSH user data: /backup command family plus backup_dsh tool and a visual Settings panel, sha256 verify with hardened re | — |

### Vision & search

| Plugin | ★ | What it does | Licence |
| --- | --: | --- | --- |
| [modlens](https://github.com/liustack/modlens) | 2890 | Vision bridge for text-only models: paste an image, get structured JSON evidence (OCR, layout, semantics). | — |
| [dsh-vision-router](https://github.com/ysr666/dsh-vision-router) | 670 | Free vision for text-only agents: built-in keyless vision chain plus pixel tools (Q&A, grounding, crop, pixel diff, colors, OCR, SVG trace, cutout, sc | — |
| [argo](https://github.com/taxueseek/argo) | 98 | Search built for agents: multilingual coverage across web, academic, code, shopping, finance, news, and encyclopedias. | — |
| [dsh-browser](https://github.com/anweat/dsh-browser) | 5 | Self-contained browser runtime: Playwright (chromium) + OpenCLI as plugin-local dependencies (global reuse fallback), exposes a `browser` service and  | — |

### Finance

| Plugin | ★ | What it does | Licence |
| --- | --: | --- | --- |
| [dsh-quant](https://github.com/pengpengyi92/dsh-quant) | 6 | Quantitative R&D toolkit for DeepSeek Harness — 46 tools across six domains covering market data, indicators, factor evaluation, walk-forward ML valid | — |
| [dsh-us-stocks](https://github.com/Realyujie/dsh-us-stocks) | 6 | US stock quotes, price history, financial statements, analyst consensus and news via yahoo-finance2. | — |
| [dsh-stock-watch](https://github.com/Awu12277/dsh-stock-watch) | 44 | A-share watchlist real-time market monitoring plugin: a collapsible popup in the top-right corner of the DeepSeek Harness (DSH) web interface for real | — |
| [capital-generation](https://github.com/v587d/capital-generation) | 2 | China A-share financial data MCP server for the harness: 11 fin_data__* tools (quotes/K-lines/financials/calendar/special-data/announcements/EDB/recon | — |
| [dsh-finance](https://github.com/zhang787jun/dsh-finance) | 4 | Financial research workflow and portfolio risk tools with source discipline for current market facts. | — |

### Plugin discovery

| Plugin | ★ | What it does | Licence |
| --- | --: | --- | --- |
| [dsh-market](https://github.com/dsh-market/dsh-market) | 889 | (Recommended) The plugin market inside DSH: a Settings page to browse and search the full community catalog by category, with confirmed one-click inst | — |
| [dsh-plugin-mall](https://github.com/1e0zj/dsh-plugin-mall) | 2 | Open plugin marketplace: live GitHub dsh-plugin topic search with per-repo package.json verification (dsh.bundle/dsh.client manifest badges and a veri | — |

### Development

| Plugin | ★ | What it does | Licence |
| --- | --: | --- | --- |
| [dsh-diff-viewer](https://github.com/lehhair/dsh-diff-viewer) | 18 | PiUI-style diff viewer replacing the stock DiffBlock for write/edit tool calls. | — |
| [dsh-code-smell](https://github.com/lucky8197/dsh-code-smell) | 1 | Code smell radar: statically scans TODO/FIXME debt, stub implementations, long lines, oversized files and duplicated blocks, with severity-sorted read | — |
| [dsh-expert-mode](https://github.com/Asher-2000/dsh-expert-mode) | 4 | Expert-mode agent preset for DeepSeek Harness (v0.3.0, bilingual EN/ZH): a chief coordinator plus 11 domain-expert subagents with automatic task deleg | — |
| [Aegis](https://github.com/GanyuanRan/Aegis) | 1048 | Software-engineering method pack for coding agents, with skills for baseline-first planning, systematic debugging, prompt hygiene, verification before | — |
| [MisakaNet](https://github.com/Ikalus1988/MisakaNet) | 404 | Failure-recovery memory: search and record failure-recovery lessons from real engineering sessions, with BM25 + semantic RAG retrieval and a lessons k | — |

### Access & mobile

| Plugin | ★ | What it does | Licence |
| --- | --: | --- | --- |
| [dsh-mobile](https://github.com/TecFancy/dsh-mobile) | 0 | Mobile adapter for the DSH web shell: overlay sidebar/details drawers, responsive composer and settings below 768px, zero desktop regression. | — |
| [dsh-remote](https://github.com/flymysql/dsh-remote) | 18 | Multi-machine remote workspace: manage many SSH hosts, pick a local or remote workspace in the native Add-workspace flow (system folder chooser / loca | — |

## Adding to this list

Open a PR editing `CATALOG.md` and `CATALOG.zh.md`. An entry needs a working
repository, a one-line description of what the plugin does, and no superlatives.
Anything that turns out to be abandoned or broken gets removed.

## Why some plugins are here and others are vendored

A plugin listed here is installed from its own repository and updated by its
own author. A plugin vendored into `packages/` is one this repo took in and
now maintains — only ever with a licence that permits it, keeping the original
copyright and licence, and saying in its README what it derives from.
