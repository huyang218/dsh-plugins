# vision

English · [中文](README.zh.md)

Lets a text-only agent call a multimodal model in the middle of a task. The
`vision` tool sends one image file to Qwen, Kimi, OpenAI, Claude, Gemini or
your own endpoint, and returns what that model reports — the image never enters the main model's
context, so a text-only route keeps working and the picture costs one tool call
instead of a model switch.

> Vendored from [gloryxpnv/dsh-tool-vision](https://github.com/gloryxpnv/dsh-tool-vision)
> (MIT, v0.3.0, commit `35789ca`) and maintained here. See
> [what changed](#what-changed-from-upstream).

## The tool

`vision(file_path, question?)` — reads a PNG, JPEG, WebP or GIF, absolute or
relative to the session workspace, and asks the configured vision model about
it. Without a question it asks for a full description.

In **structured mode** (the default) the vision model is asked for fixed-shape
evidence rather than prose, and the reply is parsed into:

| Field | What it holds |
| --- | --- |
| `summary` | one paragraph of overview |
| `ocr` | every visible character, transcribed verbatim, plus per-line text |
| `layout` | regions in reading order — title, paragraph, table, chart, form, code … |
| `semantics` | the scene, named entities with where each was seen, and relations |
| `visual` | dominant colours, style, notes |
| `uncertainty` | what the model could not determine |

That last field is the point of the shape. A vision model asked for prose will
smooth over what it could not read; asked for an explicit uncertainty list, it
has somewhere to put it, and the main model can quote the transcription instead
of trusting a retelling. The schema deliberately has **no bounding boxes and no
confidence scores** — vision models invent those.

Set `structured: false` to get the plain answer string instead.

## Install

```sh
dsh plugin --profile web add dsh-plugin-vision
```

## Providers

Pick one and supply a key. The endpoint, the wire format and a starting model
id come with it:

| `provider` | Endpoint | Format | Starting model |
| --- | --- | --- | --- |
| `qwen` *(default)* | DashScope compatible mode | OpenAI | `qwen-vl-max-latest` |
| `kimi` | Moonshot | OpenAI | `moonshot-v1-8k-vision-preview` |
| `openai` | OpenAI | OpenAI | `gpt-4o` |
| `claude` | Anthropic | Anthropic | `claude-sonnet-5` |
| `gemini` | Google | Gemini | `gemini-2.5-flash` |
| `custom` | yours | `protocol` decides | — |

Three wire formats are spoken, because they genuinely differ: OpenAI posts
`/chat/completions` with the image as a `data:` URI and a bearer token;
Anthropic posts `/messages` with a base64 `source` block, an `x-api-key`
header and a required `anthropic-version`; Gemini posts
`/models/<id>:generateContent` with `inline_data` and an `x-goog-api-key`. The
starting model ids are a place to begin, not a claim about your account —
override `model` with whatever your key is entitled to.

```yaml
- id: vision
  config:
    provider: kimi
    apiKey: '…'
```

A self-hosted or local runtime is `provider: custom` with its own `baseURL`,
`model` and `protocol`; a **loopback endpoint needs no key**, so LM Studio on
`http://127.0.0.1:1234/v1` works with `apiKey` left empty.

Until the route is complete the plugin **registers no tool at all**, and the
system prompt tells the model plainly that it cannot see images and names what
is missing — rather than leaving it a tool that always fails. The log says the
same thing, because "the plugin does nothing" is otherwise the whole report.

> [!IMPORTANT]
> The plugin states the endpoint and model in the system prompt **before** the
> model needs them, and tells it to report a failure rather than describe an
> image it could not see. A model that discovers a broken endpoint by calling
> it will otherwise describe the picture from its filename — this is the same
> failure that made the finance plugins declare their credentials up front.

Failures name what was dialled: `vision: request to http://127.0.0.1:1234/v1
failed (…)`, an HTTP status with the endpoint's own body, or an empty answer
naming the model.

## The bridge

The plugin also provides an optional `vision-bridge` service. Where the tool is
the agent deciding to look at a file, the bridge covers an image the **user**
pastes into a text-only conversation: each image part is followed by a
description so the prompt is admissible. On any failure it returns nothing and
the host keeps its original refusal — a refusal is better than an invented
description.

- `autoDescribe: true` (default) calls the vision model at admission time, which
  takes as long as the model takes.
- `autoDescribe: false` keeps the thumbnail and points the model at the
  workspace file, leaving it to call `vision` when it actually needs to look —
  one deliberate call instead of an automatic one plus a follow-up.
- `keepThumbnail` requires a host whose text-only serialiser drops image blocks
  before the wire. Leave it off on a stock host, which rejects image content on
  a text-only route.

## Config

| Key | Default | What it decides |
| --- | --- | --- |
| `provider` | `qwen` | which service looks, and so the endpoint and format |
| `apiKey` | *(empty — required unless local)* | the credential for that service |
| `baseURL` | *(empty — the provider's)* | endpoint root; required for `custom` |
| `model` | *(empty — the provider's)* | the vision model id |
| `protocol` | `openai` | wire format, **only** when `provider: custom` |
| `structured` | `true` | fixed-shape evidence instead of prose |
| `maxTokens` | `8192` | output budget — reasoning models spend part of it thinking |
| `timeoutMs` | `180000` | wall time for one request |
| `maxImageBytes` | `50 MiB` | largest image accepted |
| `autoDescribe` | `true` | bridge calls the model at admission time |
| `keepThumbnail` | `false` | bridge keeps the image block in history |

## What changed from upstream

- Renamed to `dsh-plugin-vision` for this repository's naming convention, with
  the plugin row and exported name following
- **Claude, Gemini and OpenAI-format providers are all supported.** Upstream
  spoke one wire format; the three differ in the endpoint path, the auth
  header and how an image is encoded, so each is a small table entry and the
  rest of the plugin is protocol-agnostic
- **Providers instead of a hardcoded endpoint.** Upstream shipped a local LM
  Studio address and model id, which works until it doesn't: an unconfigured
  install posts images at whatever holds that port. Now a provider carries its
  own endpoint and format, the key is the only required field, and without one
  the plugin registers nothing and says so in the prompt
- **Failures name the endpoint they dialled.** Upstream said "LM Studio request
  failed" whatever the configured `baseURL` was, which misdirects everyone
  pointing it at something else
- **The tool declares `timeoutMs`**, above its own request cap, so a slow
  endpoint fails with a reason instead of being cut down by the tool-call
  timeout policy
- **The capability is declared in the system prompt** rather than discovered by
  failing
- Added `dsh.category`, `repository.directory`, and this bilingual README pair
- Tests rewritten on `node:test`, covering the JSON recovery, the evidence
  normalisation, and every failure path through a fake endpoint

Upstream's copyright and MIT licence are kept in [LICENSE](LICENSE).

## Licence

MIT — see [LICENSE](LICENSE).
