# dsh-plugin-astock

A-share (Chinese stock market) data tools for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).

Quotes, K-lines and technical indicators for a single stock, plus **whole-market
batch tools** for screening. Data comes from EastMoney's public endpoints; a
[Tushare Pro](https://tushare.pro) token unlocks fundamentals and market-wide
history.

## Install

```sh
dsh plugin --profile web add dsh-plugin-astock
```

Configure the Tushare token through your shell's plugin settings, or in the
profile's `cordis.patch.yml`:

```yaml
- id: astock
  config:
    tushareToken: 'your-token'   # optional; empty keeps the plugin EastMoney-only
```

## Tools

| Tool | Needs token | What it does |
| --- | --- | --- |
| `astock_quote` | no | Realtime quote for one stock |
| `astock_data` | no | K-lines (daily/weekly/monthly/intraday), optionally adjusted |
| `astock_indicators` | no | K-lines + MA/MACD/RSI/KDJ/BOLL/OBV/WR/ATR/DMI in one call |
| `astock_search` | no | Find stocks by code, name or pinyin |
| `astock_market_quotes` | no | Realtime snapshot of **every** listed stock |
| `astock_market_bars` | yes | Daily bars for **every** stock over a trailing window |
| `astock_fundamentals` | yes | Daily valuation metrics (PE/PE-TTM/PB/PS/dividend yield) |

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
