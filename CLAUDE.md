# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 这个仓库是什么

DeepSeek Harness(dsh)的插件 monorepo。dsh 是"一切皆插件"的 agent 运行框架(基于 Cordis);本仓库存放通用插件(`packages/*`,每个都是可安装的 dsh bundle)和将来的客户定制组合(`customers/*`)。

- 参考文档:dsh 源码仓库在 `~/Documents/code/open/deepseek-harness`,插件开发看 `docs/user/develop/`(入门)、`docs/cookbook/adding-a-tool.md`(工具进阶)、`docs/cookbook/extension-cookbook.md`(扩展形态)、`docs/architecture.md`(扩展点总表)。
- 本机的 dsh 以桌面壳应用 "DeepSeek Harness.app" 运行(壳项目在 `~/Documents/code/open/dsh-shell`)。

## 本机运行环境(重要,和标准安装不同)

- `DSH_HOME` = `~/Library/Application Support/dsh-shell/dsh-home`(不是默认位置)。
- dsh 运行时(npm 安装的 `@deepseek-ai/dsh`)在 `~/Library/Application Support/dsh-shell/runtime/slot-a|slot-b`,CLI 入口:`node "<slot>/node_modules/@deepseek-ai/dsh/lib/bin.js"`。命令行操作 profile 前必须 `export DSH_HOME` 为上述路径。
- 改插件代码后:通过应用菜单栏 `dsh → 重启服务`(或托盘菜单)生效;插件是 `link:` 链接,无需重装。
- 服务/启动日志:`~/Library/Application Support/dsh-shell/dsh-shell.log`。会话日志(调试模型可见行为的事实来源):`$DSH_HOME/sessions/**/session.jsonl.zstd`,用 `zstd -dc` 解压看事件流。
- 模型走 tokenhub.tencentmaas.com 网关(OpenAI 兼容,但不发 SSE `[DONE]`):`packages/gateway-compat` 插件与 home 级补丁 `$DSH_HOME/cordis.patch.yml` 里的 `llm-deepseek` retryPolicy(含 `STREAM_CLOSED`)共同兜底。改动网关相关行为前先读这两处。

## 常用命令

```sh
npm install                       # monorepo 根;为 link: 插件提供 peer 依赖解析
export DSH_HOME="$HOME/Library/Application Support/dsh-shell/dsh-home"
BIN="$HOME/Library/Application Support/dsh-shell/runtime/slot-a/node_modules/@deepseek-ai/dsh/lib/bin.js"
node "$BIN" plugin --profile web add ./packages/<name>     # 安装插件到 web profile
node "$BIN" plugin --profile web remove <package-name>     # 卸载
node "$BIN" --profile web --dump-config                    # 不启动,验证组合树里的插件行
node "$BIN" --profile headless "任务描述"                   # 端到端验证(走真实模型,消耗 API 额度)
node -e "import('<abs>/packages/<name>/lib/index.js').then(m => console.log(Object.keys(m)))"  # 纯加载冒烟
```

## 插件结构约定

每个 `packages/<name>/`:

```
package.json      # name 为 dsh-plugin-<name>;"type": "module";main 指向 lib/index.js
cordis.patch.yml  # bundle 配置层:- insert: [{ id: <name>, name: dsh-plugin-<name> }]
lib/index.js      # 插件入口(纯 ESM JS,运行时不经构建直接加载)
```

- `package.json` 必须声明 `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }`,`files` 包含 `lib` 和 `cordis.patch.yml`。
- 用到的 dsh 包(`@deepseek-ai/dsh-tools` 等)写进 `peerDependencies`;monorepo 根的 `npm install` 负责让符号链接位置能解析到它们。不要在单个插件目录里建 node_modules。

## dsh 插件开发规则(违反会启动崩溃或静默失效)

1. **导出形式**:函数插件命名导出 `name` / `inject` / `apply`,**不要**同时有 default 导出(Loader 会丢弃命名空间)。依赖的服务必须列进 `inject`(如 `['tools', 'systemPrompt']`)。
2. **工具 schema 必须显式**:`defineTool` 的 output/参数 schema 里,每个 `type: 'object'` **必须显式写 `additionalProperties: true|false`**,否则整个插件树启动失败(astock 踩过,错误:`additionalProperties must be explicitly true or false`)。
3. **注册即自动清理**:一切通过 `ctx` 注册(`ctx.tools.register`、`ctx.on`、`ctx.systemPrompt.section`),插件卸载自动撤销;需手动清理的资源用 `ctx.effect(() => { ...; return 清理函数 })`。
4. **Waterfall 监听器必须调 `next()`** 才会传递(`llm/stream`、`tools/pre-execute` 等);不调就短路整条链。包装流时逐块转发,只改写自己关心的块(参照 `gateway-compat`)。
5. **不写死部署可变参数**:超时、端点、周期列表等做成插件 Config(cordis.patch.yml 可配),不要 `DEFAULT_*` 常量硬编码。
6. **通用插件禁止出现客户名/客户逻辑**;客户差异放 `customers/` bundle 的配置层,或做成 Provider 缝。
7. 不用的 import 立刻删——符号链接加载下,多余依赖就是启动崩溃源。

## 验证清单(改完插件后)

1. 纯加载冒烟(上面的 `node -e import` 一行)——抓语法/依赖错误;
2. `--dump-config` 确认插件行在组合树里;
3. 菜单重启服务,确认 `dsh-shell.log` 出现 `serving on`(启动崩溃会记完整堆栈);
4. 行为验证:UI 里让模型调用工具,或 headless 跑一条任务;调不通时解压最新会话日志看 `tool/result` 与 `finish` 事件。
