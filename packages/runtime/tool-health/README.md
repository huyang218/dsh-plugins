# dsh-plugin-tool-health

Remembers which tools have been failing — **across sessions** — and tells the
next session before it starts work.

An agent that hits a dead endpoint learns it the expensive way: one failed call
at a time, in the middle of a task, often several sessions in a row. This
plugin turns that into something the model is told up front.

```sh
dsh plugin --profile web add dsh-plugin-tool-health
```

No configuration needed. It registers **no tools** and is invisible to the
model except for one prompt paragraph, which is empty while everything works.

## What it does

Listens on `tools/result` — an emit-mode observation point, so it *cannot*
change what a tool returns — and keeps one record per tool: total calls,
failures, the current consecutive-failure streak, the last error, and when the
tool last succeeded. Records persist through the storage domain, so they
outlive the session.

When a tool has failed repeatedly and recently, the next prompt carries:

```
Recent tool failures (observed in this and earlier sessions, newest first):
- astock_market_quotes: 4 consecutive failures, latest 2 分钟前 (last succeeded 3 小时前)
  last error: UND_ERR_SOCKET: fetch failed
This is evidence from past calls, not a prohibition: the cause may have cleared.
Prefer a working alternative when one exists, and if you do call one of these and it
fails again, tell the user the source is unavailable — do not substitute or invent data.
```

## Three judgements it makes

**Consecutive failures, not a failure rate.** A tool that fails one call in
fifty is healthy; one that has failed its last three is not. A ratio cannot
tell those apart, and it only gets worse the longer a since-recovered outage
stays in the denominator.

**Failures expire.** An outage from last week says nothing about this session,
and warning about it would teach the model to avoid a tool that works. The
default memory is 24 hours (`forgetAfterHours`).

**Silence when healthy.** The report is empty text, which contributes nothing
to the prompt. A standing "all tools healthy" banner would spend tokens on
every request to say nothing.

## Config

| Key | Default | Meaning |
| --- | --- | --- |
| `unhealthyAfter` | `2` | Consecutive failures before a tool is reported |
| `forgetAfterHours` | `24` | How old a failure may be and still be mentioned |
| `maxTools` | `200` | Bound on the store; least recently touched are dropped |
| `maxListed` | `8` | How many tools one report may name |

Persistence is optional: with no storage backend composed, the plugin still
works within a single session rather than refusing to load.

## License

MIT
