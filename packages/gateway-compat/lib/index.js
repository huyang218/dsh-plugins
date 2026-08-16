/**
 * Gateway compatibility plugin: tolerate SSE streams that close without the
 * `data: [DONE]` sentinel.
 *
 * Some OpenAI-compatible gateways (e.g. tokenhub.tencentmaas.com) end the
 * stream right after the last content chunk. The DeepSeek adapter correctly
 * reports that as `STREAM_CLOSED`, which turns a fully delivered reply into a
 * failed turn. This plugin wraps the `llm/stream` waterfall and rewrites that
 * one terminal error into a normal `stop` finish — only when plain content
 * was actually received and no tool call was in flight, so genuine mid-stream
 * disconnects and truncated tool calls still fail loudly (and stay eligible
 * for the provider retry policy).
 */
export const name = 'gateway-compat'

export function apply(ctx) {
  ctx.on('llm/stream', (_options, next) => tolerateMissingDone(next()))
}

async function* tolerateMissingDone(stream) {
  let sawContent = false
  let sawToolCall = false
  for await (const chunk of stream) {
    if (chunk.type === 'text-delta' || chunk.type === 'reasoning-delta') sawContent = true
    if (chunk.type === 'tool-call-delta') sawToolCall = true
    if (
      chunk.type === 'finish'
      && chunk.reason?.kind === 'error'
      && chunk.reason.failure?.code === 'STREAM_CLOSED'
      && sawContent && !sawToolCall
    ) {
      yield { type: 'finish', reason: { kind: 'stop' } }
      continue
    }
    yield chunk
  }
}
