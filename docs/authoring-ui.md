# `ui/`

> Plugins that extend the **web client** — conversation nodes, panels, settings
> pages, themes. Where `tools/` changes what the model can do and `runtime/`
> changes how the harness runs, these change what the person sees.

## Plugins in this group

| Plugin | What it renders |
| --- | --- |
| [**astock-chart**](../packages/astock-chart) | `astock_data` results as a candlestick chart with volume, in the reply |

## What a UI plugin looks like

A UI plugin ships two halves in one package:

- a **host** entry (`main`) that mounts HTTP routes or services on the dsh
  server, and
- a **client** bundle that the web client loads, declared under `dsh.client` in
  `package.json`:

  ```json
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": {
      "platform": "web",
      "inject": ["@deepseek-ai/dsh-client-connection", "@deepseek-ai/dsh-client-runtime"]
    }
  }
  ```

Plugins that contribute a chat row register a `ConversationNodeDefinition` plus
a keyed `conversation.chat.node` renderer; the upstream
[Conversation Node guide](https://github.com/deepseek-ai/deepseek-harness/blob/main/docs/cookbook/adding-a-conversation-node.md)
has the exact steps.

## Two things to get right

- **The client half is a built bundle** in the loader's factory form
  (`window.__ModuleLoader__.load({ id, factory })`), which the host serves to
  the browser from `exports["./client"]`. A package that must compile before it
  runs cannot be installed straight from git without the user authorizing build
  scripts — so publish it to npm with the built output, or, when the card has
  no npm dependencies of its own, hand-write that small wrapper and stay
  build-free, as [`astock-chart`](../packages/astock-chart) does.
- **A route reachable from the web UI is reachable by anyone who can reach the
  UI.** If a route installs software, spends money, or restarts the service,
  say so plainly in the plugin's README and make the dangerous part opt-in
  through config.
