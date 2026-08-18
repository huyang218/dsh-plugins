# dsh-plugin-tushare

Shared [Tushare Pro](https://tushare.pro) access for the finance plugins in
this repo. It provides the `tushare` service and **registers no tools** — the
model never calls it directly.

Install it once, configure the token once, and every finance plugin uses it.

```sh
dsh plugin --profile web add dsh-plugin-tushare
```

```yaml
- id: tushare
  config:
    token: 'your-tushare-token'
```

## Why a shared provider

Each finance plugin could carry its own token field, but then the user pastes
the same token four times, and — the real problem — each plugin meters its own
per-minute quota while Tushare meters the **account**. Four plugins each
politely staying under the limit still blow through it together.

One service means one token, one quota gate, and one trading calendar.

## Is Tushare free?

Tushare Pro accounts are free to create, but **interfaces are gated by
points**, and points come from registration, activity, or payment. Roughly:

| Tier | Interfaces used by these plugins |
| --- | --- |
| `basic` — entry-level account | `trade_cal`, `stock_basic`, `daily` |
| `points` — higher score required | `daily_basic`, `income`, `balancesheet`, `cashflow`, `fina_indicator`, `express`, `moneyflow`, `top_list`, `hsgt_top10`, `moneyflow_hsgt`, `cb_basic`, `cb_daily`, `stk_holdernumber` |

Tushare moves these thresholds, so the table is documentation, not a gate. The
authoritative answer is the error you get: it quotes the current requirement.
`ctx.tushare.access(apiName)` returns the tier so a tool can warn up front.

## What a failure tells the agent

Tushare answers **every** call with HTTP 200 and reports failure in the body,
and three unrelated problems arrive as the same `code: 40203`. This client
separates them, because they call for opposite responses:

| Kind | Meaning | What the agent should do |
| --- | --- | --- |
| `no-token` | Not configured, or the token was rejected | Ask the user to set a valid token |
| `access-denied` | The token lacks the points for this interface | Report it — retrying and rewording will not help |
| `rate-limited` | Per-minute quota exhausted (already retried with backoff) | Wait, or narrow the request |
| `provider-error` | Tushare rejected the request itself | Usually a bad parameter — a bug to fix |
| `transport` | The request never got an answer | Network problem; retry may help |

`access-denied` and `no-token` messages say explicitly that the data is
unavailable **and that the agent must not substitute or invent it**. That
sentence is there because the alternative was observed: told only that data was
missing, an agent assembled numbers from elsewhere and answered with
confidence. An unavailable interface has to end the task, not redirect it.

## Service API

```ts
ctx.tushare.configured                      // boolean: is a token set?
ctx.tushare.access(apiName)                 // 'basic' | 'points' | undefined
ctx.tushare.query({ apiName, params, fields, signal })   // → rows, rejects with TushareError
ctx.tushare.tradeDates({ endDate, count, signal })       // → ['20260810', …] ascending
```

Consumers declare `inject: ['tools', 'systemPrompt', 'tushare']`, following the
provider/consumer split dsh uses for its own capabilities (`dsh-bash-local` +
`dsh-tool-bash`). This plugin must be installed for them to load.

Windows are counted in **trading days** from the exchange calendar — calendar
arithmetic cannot tell you that a Monday was a holiday.

## License

MIT
