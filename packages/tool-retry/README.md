# dsh-plugin-tool-retry

English | [中文](README.zh.md)

Retries a tool call that failed for a reason that might clear — a reset
socket, a rate limit, a timeout — for the tools you declare safe to repeat.

dsh already retries the model request (`dsh-llm-retry`) and enforces tool
deadlines (`dsh-tool-call-timeout-policy`). Nothing retried the tool call
itself, so a data source closing one socket mid-scan ended the task, and an
agent told only that the data was unavailable was left to improvise.

```sh
dsh plugin --profile web add dsh-plugin-tool-retry
```

## It retries nothing until you say what is safe

Repeating a tool that wrote, ordered or sent something does it twice. Nothing
in the tool contract says which tools are idempotent — `isConcurrencySafe` is
about overlap, not repetition — so the operator names them, and the default
list is empty:

```yaml
- id: tool-retry
  config:
    retryTools: ['astock_*', 'ainfo_*', 'web_fetch']   # read-only tools only
```

Patterns are literal names or a trailing `*` prefix, deliberately **not**
regular expressions: this list decides what may execute twice, and a stray `.`
matching everything is not a mistake worth enabling.

## What counts as worth retrying

Failures where the request never got an answer, or the answer said "later":
socket resets and `fetch failed`, `429`/`5xx`, rate-limit messages in either
language, timeouts. A wrong argument, a permission denial or a missing file
will fail identically forever; retrying those only makes the user wait.

Backoff is exponential and capped, because the failures worth retrying are
usually a remote system under load, and a tight loop is how a client turns
someone else's brief overload into its own outage.

## Two things it will not do

**It never turns a failure into a success.** An exhausted retry returns the
real failure with one line appended — how many attempts were made — so the
model reads a persistent outage as persistent rather than as one unlucky call,
and reports it instead of trying the same thing again.

**It never leaves a retry unstoppable.** cordis consumes its waterfall
listener list, so a repeated `next()` reaches the tool body directly and skips
every wrapper already shifted off — including the official timeout policy.
Each retry therefore runs under a deadline of this plugin's own, fused with
the caller's cancellation rather than replacing it. Cancelling during the
backoff returns the failure already in hand instead of starting an attempt
nobody is waiting for.

## Config

| Key | Default | Meaning |
| --- | --- | --- |
| `retryTools` | `[]` | Tools safe to repeat; empty means nothing is retried |
| `maxAttempts` | `3` | Attempts per call, including the first |
| `backoffMs` | `500` | Wait before the first retry, doubling after |
| `maxBackoffMs` | `8000` | Cap on the wait |
| `retryDeadlineMs` | `120000` | Deadline imposed on each retry attempt |

Pairs naturally with [`tool-health`](../tool-health), which remembers what has
been failing, and [`tool-usage`](../tool-usage), which measures what it costs.

## License

MIT
