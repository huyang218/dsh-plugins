# im

English · [中文](README.zh.md)

Command the agent from a chat app on your phone. A message in Lark, WeCom,
DingTalk or QQ drives a real agent turn in a real session, and the reply comes
back to the same chat. Each chat keeps its own session across messages and
across restarts.

## Channels

| Channel | Transport | Public URL needed | Credentials |
| --- | --- | --- | --- |
| Lark / 飞书 | event subscription (HTTP callback) | **yes** | App ID, App Secret, Verification Token |
| WeCom / 企业微信 | app callback (HTTP, XML + AES) | **yes** | Corp ID, Corp Secret, Agent ID, Token, EncodingAESKey |
| DingTalk / 钉钉 | Stream mode (WebSocket out) | no | Client ID, Client Secret |
| QQ | official bot gateway (WebSocket out) | no | App ID, App Secret |

**The public-URL column is the first thing to plan around.** DingTalk and QQ
have this machine open the socket, so they work from a laptop behind NAT with
nothing exposed. Lark and WeCom deliver over a callback, so dsh has to be
reachable from the internet — a tunnel or a reverse proxy in front of the dsh
web server, which otherwise binds to loopback.

> [!IMPORTANT]
> **Personal WeChat is not supported, on purpose.** It has no official bot API.
> The plugins that reach it work through gateways (iLink, wechaty and similar)
> that impersonate a WeChat client — against WeChat's terms, with the account
> carrying the risk. WeCom is the official route, and its messages arrive on the
> same phone. If you need personal WeChat specifically, the
> [catalogue](../../CATALOG.md) lists the plugins that do it, marked as
> unofficial.
>
> Lark's long-connection mode is also skipped: its frames are protobuf, which
> means the official SDK, which means a dependency and a build step. This repo
> has neither, so Lark uses the callback.

## Install

```sh
dsh plugin --profile web add dsh-plugin-im
```

Nothing is enabled until it is configured, and **nobody is allowed until you say
who is**:

```yaml
- id: im
  config:
    allowFrom: ['ou_your_open_id']
    cwd: '/Users/you/code/project'
    dingtalk:
      enabled: true
      clientId: '…'
      clientSecret: '…'
```

> [!WARNING]
> `allowFrom` is empty by default and an empty allowlist admits **nobody**. This
> is a remote control for a machine with shell and file access; the failure mode
> of an open default is not a missing feature, it is someone else's message
> running as you. Ids are matched exactly — no wildcards.
>
> Don't know your id? Send the bot a message. The log prints the id it refused,
> which is the one to paste in.

## In the chat

Send anything and it becomes the prompt. Four commands:

| Command | What it does |
| --- | --- |
| `/new` | start a fresh session for this chat |
| `/stop` | cancel the turn that is running, keeping anything queued |
| `/status` | which session this chat drives, its workspace, and whether it is busy |
| `/help` | list these |

A line that merely starts with a slash — `/usr/local/bin`, a regex, a path — is
sent to the model as text, not rejected as an unknown command.

The reply is sent when the turn ends, not streamed: a chat is not a terminal,
and a message per chunk is unreadable. Replies longer than `replyChars` are
split at a paragraph or line break and labelled `[1/3]`, so you can tell whether
you have the end. A turn that ended without writing anything still sends a line
saying so — silence is the one thing a bridge must never be mistaken for.

## What it does not do

- **It does not echo other surfaces.** A turn you start in the web UI is not
  forwarded to your chat; only turns this bridge started are answered.
- **It does not approve tools for you.** Approvals still happen wherever the
  session's permission preset says. Sending `/stop` is the control you have from
  a phone.
- **It does not attach images or files.** Text in, text out.

## Config

| Key | Default | What it decides |
| --- | --- | --- |
| `allowFrom` | `[]` | sender ids that may command the agent; empty denies all |
| `cwd` | *(dsh's own)* | workspace for sessions started from a chat |
| `agentPreset` | *(deployment default)* | preset for those sessions |
| `replyChars` | `1800` | largest chat message before splitting |
| `refusalNotice` | *(empty)* | what to tell an unauthorised sender; empty says nothing |
| `dedupeEntries` | `500` | how many delivery ids to remember |
| `lark` / `wecom` / `dingtalk` / `qq` | disabled | per-channel credentials |

Every field is in the install dialog, so none of this needs a command line.

## Verification status

The decisions and the wire formats are covered by tests — the allowlist,
delivery dedupe, command parsing, reply splitting, each platform's signature and
payload shape, and the whole chat-to-turn path against a fake host. What tests
cannot cover is a live account: **the four channels have not been exercised
against the real platforms**, so treat the first connection of each as the thing
to watch, and read the log — every refusal, mismatch and reconnect says which
channel and why.

## Licence

MIT — see [LICENSE](LICENSE).
