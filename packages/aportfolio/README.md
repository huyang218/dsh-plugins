# dsh-plugin-aportfolio

English | [中文](README.zh.md)

The agent remembers what you own and what you are watching, across sessions —
so "how are my holdings doing" is a question it can answer without being told
the positions again every time.

```sh
dsh plugin --profile web add dsh-plugin-aportfolio
```

Self-contained: it fetches its own prices from EastMoney's public endpoint and
needs no token and no other plugin. It does need a storage backend, which the
standard profile composes.

## Tools

| Tool | What it does |
| --- | --- |
| `aportfolio_view` | Prices every stored entry live: per-position profit and weight, portfolio totals, and watchlist entries that hit a buy or sell target |
| `aportfolio_edit` | Records or removes one holding or watchlist entry |

```
持仓 2 只,市值 18.50万,盈亏 +1.00万(5.74%)
  600519 贵州茅台 100股  现价 1297.99  盈亏 +8.17%  占比 70.1%
  000001 平安银行 5000股  现价 11.05  盈亏 +0.45%  占比 29.9%
```

## Four rules it keeps

**State lives in storage, not in the transcript.** A position the agent has to
re-read from chat history is a position it will eventually get wrong.

**Nothing is stored that the user did not say.** The prompt tells the model to
ask rather than guess, and `set` replaces a stock's entry outright — it takes a
complete share count and cost, never a delta, so a misread "bought 100 more"
cannot silently double a holding.

**An unpriced holding is unknown, not worthless.** When a quote fails the row
keeps its shares and loses its value, the total says how many it excluded, and
the summary states that the number is therefore incomplete. A zero there would
look authoritative and drag the whole portfolio down.

**At the entry limit it refuses rather than evicts.** A silently dropped
holding is a wrong portfolio the user has no way to notice.

## Config

| Key | Default | Meaning |
| --- | --- | --- |
| `maxEntries` | `200` | Cap on each of holdings and watchlist |
| `quoteConcurrency` | `6` | Parallel quote requests |

## License

MIT
