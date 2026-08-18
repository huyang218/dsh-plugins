# `runtime/`

> Plugins that change **how the harness itself behaves**: LLM stream handling,
> tool dispatch policy, retries, deadlines, metrics, audit.

They listen on waterfall extension points instead of registering tools, so they
are **invisible to the model** — no schemas, no prompt text, no tokens. The
model's behaviour changes because the machinery around it changed.

## Plugins in this group

| Plugin | Shape | What it does |
| --- | --- | --- |
| [**gateway-compat**](gateway-compat) | `llm/stream` listener | Tolerates OpenAI-style gateways whose SSE stream ends without the `[DONE]` sentinel |
| [**tool-health**](tool-health) | `tools/result` observer | Remembers which tools have been failing across sessions and warns the next one |
| [**tushare**](tushare) | `tushare` service | Shared Tushare Pro access for the finance plugins: one token, one quota gate, one calendar, and typed failures |

Two shapes live here, and both are invisible to the model: **waterfall
listeners**, which change how the harness runs, and **service providers**,
which hold something several plugins need. A provider belongs here rather than
in `tools/` because it registers no tools — what it exposes is `ctx.<name>`,
for other plugins to inject.

## Picking the extension point

| You want to | Use |
| --- | --- |
| Allow / deny / ask before a call runs | `tools/pre-execute` |
| Refuse permanently, unrevocably | `ctx.tools.guard()` |
| Wrap dispatch — timeout, retry, metrics | `tools/execute` |
| Rewrite the result or attach context | `tools/post-execute` |
| Observe the final result, changing nothing | `tools/result` |
| Change which tools are visible | `ctx.tools.restrict()` |
| Reshape the model's token stream | `llm/stream` |

Reach for the narrowest one that does the job: an observer that cannot alter
the result is much easier to reason about than a wrapper that can.

## Rules that bite

- **A waterfall listener must call `next()`.** Forgetting short-circuits the
  entire chain — every listener behind yours stops running, silently.
- **Wrap streams chunk by chunk.** Forward everything; rewrite only the chunks
  you own. `gateway-compat` is the reference: it rewrites exactly one terminal
  error, and only when content had already arrived and no tool call was in
  flight, so genuine mid-stream cuts still fail and stay retryable.
- **Never turn a real failure into a success.** These plugins sit where errors
  are decided, so an over-eager rewrite converts "the answer was truncated"
  into "the answer is complete". Narrow the condition until the rewrite is
  provably safe, and let everything else fail loudly.
- **Registration cleans itself up.** Everything registered through `ctx` is
  reverted on unload (HMR included); anything else needs `ctx.effect`.

## Testing

These plugins are pure functions over an event stream, so they need no network
and no dsh instance: capture the listener that `apply` registers, feed it a
hand-built async generator, and assert both directions —

- the rewrite fires on the case it is for, **and**
- a genuine failure still comes out unchanged.

The second assertion is the one that matters. A test suite that only proves the
happy path lets a too-broad condition through, and that condition is exactly
what hides real errors in production.

## Adding a runtime plugin

1. `mkdir packages/runtime/<name>` with `package.json`, `cordis.patch.yml`,
   `lib/index.js`, `README.md`, `LICENSE`.
2. `export const name` and `apply` as **named** exports (plus `inject` if you
   depend on services) — never a default export.
3. Say in the README what it rewrites and, just as importantly, what it
   deliberately leaves alone.

Full rules: the "事件(waterfall)" section of [CLAUDE.md](../../CLAUDE.md).
