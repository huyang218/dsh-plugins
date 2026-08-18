# dsh-plugin-astock-chart

English | [中文](README.zh.md)

Draws the candlesticks in the reply. An `astock_data` result renders as an OHLC
chart with a volume band instead of a table of numbers.

```sh
dsh plugin --profile web add dsh-plugin-astock-chart
```

Needs [`dsh-plugin-astock`](../astock) for the data, and the web
client for the card. Restart the service after installing; the browser picks
the bundle up on the next load.

> [!IMPORTANT]
> **The agent must be able to call `astock_data` natively.** Under a pure Code
> Mode preset every call goes through `run_code`, and a code-dispatched
> sub-call has no card — the runtime skips `presentationMeta` for it, so no
> series ever reaches the browser and you get the generic row instead of a
> chart. Use a preset whose tool presentation is `native` or `both`; `both`
> keeps `run_code` available for batch work while single-stock lookups stay
> native and drawable.

## How it renders

The card registers into the web client's `tool.call.toolview` slot, keyed by
the wire tool name `astock_data`. Where a tool has no registered view,
`ui-tool` renders its generic card — so this plugin adds a view rather than
replacing machinery, and a result it cannot draw falls back to that generic
card instead of a blank box.

Bars reach the browser through `presentationMeta`. The canonical value is
execution-local — it never reaches a card and never survives replay — so the
card's data has to be projected onto the result, which is persisted. That bound
is why the projection carries a screen's worth of candles (120) rather than the
whole history a caller may have requested.

## Chart decisions

**The price scale spans the visible highs and lows**, not zero. A stock that
moved 2% would otherwise render as a flat line at the top of an empty chart. A
flat range — one bar, or a limit-locked stretch — is padded so the candle stays
visible instead of collapsing to nothing.

**Rising is red and falling is green**, the A-share convention, which is the
inverse of most Western charts.

**Volume is scaled against its own peak** in the window, so the band shows
relative activity rather than a value the price axis cannot express.

**A missing price drops the bar.** The packed series marks an unreported field
with an empty token, and `Number('')` is `0` — a bar coerced that way would
draw a candle crashing to zero.

## No build step

This package ships a hand-written client bundle in the module loader's
documented factory form (`window.__ModuleLoader__.load({ id, factory })`). The
card has no npm dependencies of its own — React arrives through the
host-injected `require` table — so a bundler would add a toolchain, a build
step, and a build-authorization prompt on git installs in order to concatenate
one file with nothing.

The tests load that exact shipped file with a stand-in loader table, so they
exercise the published artifact rather than a copy of its logic.

## License

MIT
