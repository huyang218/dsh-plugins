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

### Chat platforms — command the agent from your phone

Every one of these drives an agent turn from a chat app, so a phone is enough
to give it work and answer its questions. Two properties decide whether one is
practical for you: whether it needs a **public callback URL** (a long-connection
or Stream mode does not, which matters when dsh runs on a laptop), and whether
it reaches WeChat through an **official API or a third-party protocol gateway**.
Personal WeChat has no official bot API — the plugins that reach it use gateways
like iLink, against WeChat's terms, at some risk to the account. WeCom, Lark,
DingTalk and QQ all have official bots.

| Plugin | ★ | What it does | Licence |
| --- | --: | --- | --- |
| [dsh-im](https://github.com/xmanrui/dsh-im) | 51 | Nine channels in one plugin — Lark, WeChat, DingTalk, WeCom, QQ, Slack, Telegram, Discord, WhatsApp — paired by QR code or bot credentials. | MIT |
| [dsh-notifier](https://github.com/THEWOLFWALKER/dsh-notifier) | 40 | One `notify()` API across 25+ channels (Telegram, DingTalk, Lark, WeCom, QQ, Bark, ntfy, webhook …) plus remote control. | MIT |
| [dsh-lark](https://github.com/omdsh-dev/dsh-lark) | 32 | Lark channel where each chat drives its own agent: approvals, model questions and plan review come back as cards; `/cd`, `/model`, `/new` in chat. | BSD-3-Clause |
| [dsh-lark-bridge](https://github.com/imetn/dsh-lark-bridge) | 7 | Lark two-way controller with project/session routing, interactive cards, approvals, attachments and task control. | — |
| [dsh-feishu](https://github.com/xmanrui/dsh-feishu) | 7 | Attaches a Lark bot by scanning a QR code. | — |
| [dsh-im-bridge](https://github.com/BiBoyang/dsh-im-bridge) | 7 | WeChat two-way bridge over the iLink gateway: turn-complete and approval pushes, in-chat approval, long-reply segmentation. Unofficial protocol. | — |
| [dsh-feishu-bridge](https://github.com/wz-heng/dsh-feishu-bridge) | 5 | Fail-closed Lark bridge: allowlist denies by default, webhook signature with a time window and replay guard, optional Allow/Deny card before every bash call. Official SDK, pinned. | MIT |
| [dsh-chatnode-wechat](https://github.com/Jesse-njx/dsh-chatnode-wechat) | 6 | Chat, monitor and approve from WeChat through the iLink gateway. Unofficial protocol. | — |
| [telegram](https://github.com/LoserFox/telegram) | 6 | Telegram Bot API bridge: long polling, per-chat sessions, HTML formatting. | — |
| [dsh-slack](https://github.com/STARDUSTLC666/dsh-slack) | 4 | Two-way Slack over Socket Mode — no public callback. | — |
| [dsh-dingtalk](https://github.com/STARDUSTLC666/dsh-dingtalk) | 3 | DingTalk group-robot notifications (webhook + signature, no runtime dependencies). Outbound only. | — |
| [dsh-discord](https://github.com/suuuuuu-1/dsh-discord) | 2 | Discord remote controller over DMs, mentions and threads, with slash commands, approvals and attachments. | — |
| [dsh-dingtalk-channel](https://github.com/ttmouse/dsh-dingtalk-channel) | 0 | Two-way DingTalk over Stream mode: each chat drives an agent, replies flow back over the WebSocket. No public callback. | MIT |
| [dsh-wecom](https://github.com/michaelcode-wang/dsh-wecom) | 0 | WeCom smart-robot bridge: two-way over the aibot WebSocket with a bot id and secret. No public callback. | MIT |
| [dsh-feishu-chat](https://github.com/Qing45/dsh-feishu-chat) | 0 | Two-way Lark bridge on the official WebSocket long connection, routed to the newest session of a chosen workspace. | MIT |
| [dsh-Remote](https://github.com/Blank-not-black/dsh-Remote) | 8 | Mobile remote-control suite: sidebar entry, Bearer-token gateway with LAN/Tailscale self-healing, an Android app covering sessions, approvals and questions, and `/fs/*` file endpoints. | — |
| [dsh-web-remote](https://github.com/godchen520/dsh-web-remote) | 4 | Reach dsh from a phone: Cloudflare Quick Tunnel link or LAN HTTP/HTTPS direct with a self-signed certificate, token auth, QR panel. | — |

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
