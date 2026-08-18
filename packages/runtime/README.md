# runtime/

Plugins that change **how the harness itself behaves** — LLM stream handling,
tool dispatch policy, retries, metrics. They listen on waterfall extension
points (`llm/stream`, `tools/pre-execute`, `tools/execute`, …) rather than
registering tools, so nothing here is directly visible to the model.
