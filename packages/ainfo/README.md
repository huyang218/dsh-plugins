# dsh-plugin-ainfo

English | [中文](README.zh.md)

A-share **information** tools for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness):
what was said about a company, rather than what it traded at.

Prices, indicators and screening live in
[`dsh-plugin-astock`](../astock). The two are separate plugins because the
questions are separate — an agent screening for a 40-day low needs none of
this, and every registered tool spends system-prompt budget on every request.

## Install

Both this plugin and the shared Tushare provider, which holds the token:

```sh
dsh plugin --profile web add dsh-plugin-ainfo
dsh plugin --profile web add dsh-plugin-tushare
```

```yaml
- id: tushare
  config:
    token: 'your-tushare-token'
```

> [!NOTE]
> Its result cards carry a `presentationMeta` projection, which a call
> dispatched inside `run_code` never receives. Under a pure Code Mode
> preset the answers are unaffected but the cards fall back to the generic
> one — see [tool presentation modes](../../docs/presentation-modes.md).

## Tools

**Every tool here needs a Tushare Pro token, and none has a free fallback** —
there is no public endpoint serving this material reliably. Each tool says so
in its own description so the model can tell you what is missing instead of
discovering it mid-answer.

| Tool | What it returns |
| --- | --- |
| `ainfo_news` | Major market news over a time window: headline, source, timestamp, plain-text excerpt |
| `ainfo_research` | Broker research: rating, target price, org and author — for one stock or a whole report date |
| `ainfo_events` | Company disclosures by `kind`: `forecast` (earnings pre-announcements), `dividend`, `holdertrade` (insider buying/selling), `float` (lock-up expiries), `holders` (top-ten register) |

Tushare gates interfaces by account points, so a valid token may still be
refused. The refusal names the requirement and is passed through as a
permission error; see [dsh-plugin-tushare](../tushare) for what each
failure kind means.

## Two habits this plugin enforces

**Text is passed through verbatim.** Headlines, report titles and disclosure
summaries are never paraphrased by the plugin, so the model can quote them.
News bodies are the one exception: the feed ships article HTML, so excerpts are
stripped to plain text and bounded — an excerpt is labelled as one and must not
be presented as the full story.

**Ratings are opinions.** `ainfo_research` summarizes the distribution and the
target-price range, and says in its own output that these are brokers' views to
be attributed, not facts to be asserted.

## License

MIT
