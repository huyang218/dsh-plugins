# dsh-plugin-tool-usage

English | [中文](README.zh.md)

Measures what a session actually spends on tools — how many calls, how long
each tool takes, how often it fails — and exposes the tally as the `toolUsage`
service.

Heavy work is invisible until something times out. A whole-market pull and a
single quote look identical in a transcript; this makes the difference legible
while the session is still running.

```sh
dsh plugin --profile web add dsh-plugin-tool-usage
```

Measured on real calls:

```
Tool usage: 3 calls, 0 failed, 1.7s spent in tools.
  astock_market_bars: 1×  total 1.4s  mean 1.4s  p95 1.4s
  astock_financials: 1×  total 203ms  mean 203ms  p95 203ms
  astock_quote: 1×  total 107ms  mean 107ms  p95 107ms
```

## How it works

Wraps `tools/execute` — the documented seam for timeouts, retries and metrics
— and changes nothing about the call: it forwards `next()` and returns that
result untouched. A thrown dispatch is measured too, in a `finally`, because a
call that blew up still spent its time; dropping it would make the worst tool
in a bad session look like the cheapest.

## What it exposes

**A service, not a tool.** `ctx.toolUsage` gives `snapshot()` (machine-readable
totals plus the per-tool table), `report()` (the block above) and `reset()`. A
model-facing tool would spend prompt budget on every request to describe a
report nobody asked for; a service lets an operator, a UI panel or another
plugin read the tally when it is actually wanted.

**An optional budget warning.** Set `budgetCalls` or `budgetSeconds` and, once
a session crosses either, the prompt carries a short note naming where the time
went and what to do about it — batch over per-item calls, narrower windows,
reuse what was already fetched. Below the budget the text is empty and
contributes nothing, so an ordinary session pays nothing for this plugin.

**A summary on the way out.** When the plugin unloads (session end, service
restart) the tally goes to the log, so a heavy session can be reviewed after
the fact.

## Two judgements worth knowing

**Sorted by total time, not call count.** The tool worth looking at is the one
the session spent its wall clock in — a tool called once for twelve seconds is
that, and a tool called forty times for a millisecond is not.

**Bounded samples.** Only the most recent durations per tool are kept (default
200) for the percentiles. Percentiles should describe how a tool behaves *now*;
retaining every duration ever measured lets an hour-old cold start drag them
forever. Call and failure counts stay complete.

## Config

| Key | Default | Meaning |
| --- | --- | --- |
| `budgetCalls` | `0` (off) | Calls before the prompt warns |
| `budgetSeconds` | `0` (off) | Seconds in tools before the prompt warns |
| `sampleLimit` | `200` | Durations retained per tool for percentiles |
| `topN` | `10` | Tools listed in a report |
| `logOnDispose` | `true` | Log the summary when the plugin unloads |

## License

MIT
