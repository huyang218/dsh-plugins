# dsh-plugin-gateway-compat

English | [中文](README.zh.md)

Compatibility shim for third-party OpenAI-style gateways used with
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).

Some gateways end an SSE stream right after the last content chunk, without the
`data: [DONE]` sentinel. The adapter correctly reports that as `STREAM_CLOSED`,
which turns a fully delivered reply into a failed turn. This plugin wraps the
`llm/stream` waterfall and rewrites that one terminal error into a normal
`stop` finish.

It does so **only** when plain content was actually received and no tool call
was in flight, so genuine mid-stream disconnects and truncated tool calls still
fail loudly and stay eligible for the provider's retry policy.

## Install

```sh
dsh plugin --profile web add dsh-plugin-gateway-compat
```

No configuration. The plugin registers no tools and is invisible to the model.

## License

MIT
