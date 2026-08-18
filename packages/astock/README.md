# dsh-plugin-astock

English | [中文](README.zh.md)

A-share (Chinese stock market) data tools for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).

Quotes, K-lines and technical indicators for a single stock, plus **whole-market
batch tools** for screening. Data comes from EastMoney's public endpoints; a
[Tushare Pro](https://tushare.pro) token unlocks fundamentals and market-wide
history.

## Install

```sh
dsh plugin --profile web add dsh-plugin-astock
```

That alone gives you every free tool. The Tushare-backed tools appear once the
shared provider is installed and holds a token:

```sh
dsh plugin --profile web add dsh-plugin-tushare
```

```yaml
- id: tushare
  config:
    token: 'your-tushare-token'
```

The token lives on the provider, not here, so every finance plugin shares one
token and one quota. See [dsh-plugin-tushare](../tushare) for what
Tushare charges for and what a permission failure tells the agent.

## Tools

Free tools work with no credentials at all. The rest need a Tushare Pro token,
and each says so in its own description — so the model can pick a free tool
when one will do, and tell you exactly what is missing when one will not.

| Tool | Cost | What it does | Free fallback |
| --- | --- | --- | --- |
| `astock_quote` | free | Realtime quote for one stock | — |
| `astock_data` | free | K-lines: daily/weekly/monthly/intraday, adjustable | — |
| `astock_indicators` | free | K-lines + MA/MACD/RSI/KDJ/BOLL/OBV/WR/ATR/DMI in one call | — |
| `astock_search` | free | Find stocks by code, name or pinyin | — |
| `astock_market_quotes` | free | Realtime snapshot of **every** listed stock | — |
| `astock_fundamentals` | Tushare | Daily valuation: PE, PE-TTM, PB, PS, dividend yield, caps | `astock_quote` has PE and caps only |
| `astock_market_bars` | Tushare | Daily bars for **every** stock over a trailing window | `astock_data`, one stock at a time |
| `astock_financials` | Tushare | Income statement, balance sheet, cash flow, key ratios by period | none |
| `astock_moneyflow` | Tushare | Per-stock flow by order size, Stock Connect flows, 龙虎榜 | none |
| `astock_convertible_bonds` | Tushare | Every convertible bond with conversion value and premium | none |

Tushare gates interfaces by account points, so a valid token still may not
reach all of them. A refusal comes back as a permission error that names the
requirement — the plugin passes it through rather than treating the data as
merely missing, and the model is told to report it instead of substituting
another source.

## Screening needs Code Mode

The two `astock_market_*` tools answer with a whole-market dataset as their
canonical value and render only a summary — thousands of rows must never enter
the model's context as text. The data is therefore reachable only from a
`run_code` program:

```ts
const { codes, rows, fields, tradeDates } = await tools.astock_market_bars({
  endDate: '20260814', days: 40,
})
// rows[i] packs every bar of codes[i]: bars joined by ";", fields joined by ","
```

Run these under an agent preset that enables Code Mode (the shipped `code`
preset). Under native tool calls the summary is all the model sees, and a
screen built on guesses is worse than no screen at all.

Scanning happens inside the tool, so cost is O(trading days), not O(stocks):
one whole-market window of 40 days is ~40 requests and a couple of seconds,
where fetching stock by stock is thousands of requests and gets throttled.

## Notes on the data

- Bars from `astock_market_bars` are **unadjusted** (不复权).
- Missing metrics are **absent keys**, never `0` or `NaN` — providers spell
  absence as `'-'` (EastMoney) or `null` (Tushare).
- When EastMoney's realtime market list is unavailable the snapshot falls back
  to the delayed host and sets `delayed: true`; a screen can then say so.

## License

MIT
