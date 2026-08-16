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
npm test                          # 全部单元测试;单包:npm test -w dsh-plugin-<name>
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
- 发布给客户前:补 `prepare` 脚本(git 直装场景)或发私有 npm。

## 现有插件(改动前先读对应入口)

- **astock**:A 股行情工具(astock_data / astock_indicators / astock_quote / astock_search)。分层:`lib/data.js` 封装东方财富(EastMoney)公开 API 的抓取与代码归一化(市场前缀 0=深/1=沪/2=京),`lib/indicators.js` 是纯函数指标计算(MA/MACD/RSI/KDJ/BOLL 等),`lib/index.js` 只做工具注册与格式化输出。它是本仓库 `defineTool` 完整形态的参考实现:parameters、output.schema、`render`(模型可见文本)、`presentationMeta` / `presentCall` / `presentResult`(UI 卡片)、`timeoutMs`、`isConcurrencySafe`,以及每个工具配套的 `ctx.systemPrompt.section`。
- **gateway-compat**:`llm/stream` waterfall 包装的参考实现——把网关缺失 `[DONE]` 导致的 `STREAM_CLOSED` 终止错误改写为正常 `stop`,但仅在已收到正文且无 tool call 进行中时,真正的中途断流仍然失败并保留重试资格。

## dsh 插件开发规范(违反会启动崩溃或静默失效)

### 插件形态与生命周期

1. **导出形式**:函数插件命名导出 `name` / `inject` / `apply(ctx, config)`,**不要**同时有 default 导出(Loader 会丢弃命名空间,`inject` 静默失效)。依赖的服务必须列进 `inject`(如 `['tools', 'systemPrompt']`),框架保证服务就绪后才调用 `apply`。
2. **注册即自动清理**:一切通过 `ctx` 注册(`ctx.tools.register`、`ctx.on`、`ctx.systemPrompt.section`),插件卸载(含 HMR 热替换)自动撤销;需手动清理的资源用 `ctx.effect(() => { ...; return 清理函数 })`。
3. 不用的 import 立刻删——符号链接加载下,多余依赖就是启动崩溃源。

### 配置

4. **不写死部署可变参数**(超时、端点、周期列表等)。检验标准:能否只改 cordis.patch.yml 不改代码就换值。需要校验时导出 Schemastery `Config`(默认值写在 schema 里,不要导出普通对象),让无效配置在加载时响亮失败。
5. **通用插件禁止出现客户名/客户逻辑**;客户差异放 `customers/` bundle 的配置层,或做成 Provider 缝。

### 工具(defineTool)

6. **schema 必须显式**:每个 `type: 'object'` 节点**必须显式写 `additionalProperties: true|false`**,否则 `defineTool` 定义期即抛错、整个插件树启动失败(astock 踩过,错误:`additionalProperties must be explicitly true or false`)。
7. **execute 只返回 `output.schema` 声明的规范 JSON 值**,把它当程序化 API 设计(直接给 id 和字段;Code Mode 会以 `await tools.<name>(args)` 拿到该值);面向模型的自然语言放 `output.render(args, value)`。基础设施故障抛异常(→ `isError`);不理想但成功的领域结果写进规范值,由 render 解释。
8. 遵守 `exec.signal` 取消;`args` 视为只读;注册后不改 schema、不换回调。
9. **UI 卡片展示器(`presentCall` / `presentResult`)必须是纯函数**——会话回放时也会执行,不做 I/O、不读时钟/随机数;结果期事实用 `output.presentationMeta` 投影持久化。UI 格式(围栏代码块、diff 文本)不进入规范值或 render 输出。

### 事件(waterfall)

10. **Waterfall 监听器必须调 `next()`** 才会传递(`llm/stream`、`tools/pre-execute` 等);不调就短路整条链。包装流时逐块转发,只改写自己关心的块(参照 `gateway-compat`)。
11. 扩展点选型:允许/拒绝/询问用 `tools/pre-execute`;不可撤销的最终拒绝用 `ctx.tools.guard()`;包裹分发(超时/重试/指标)用 `tools/execute`;变换结果用 `tools/post-execute`;只观测不改用 `tools/result`;工具可见性过滤用 `ctx.tools.restrict()`。

### bundle 与配置层

12. patch 里插件行按**包名**引用(`name: dsh-plugin-<name>`),不是相对路径。层顺序(后应用按行胜出):profile 的 bundles 按安装顺序 → profile 自己的 `cordis.patch.yml` → home 级 `$DSH_HOME/cordis.patch.yml` → `--patch` overlay。patch 覆盖是**整行 config 替换、不深度合并**——覆盖别人的行要重述全部键;反过来给用户大概率保留的默认值,其余交给 schema。
13. 分发:git 直装拉源码不构建,需要自包含 `prepare` 脚本 + 用户在 `pnpm-workspace.yaml` 里 `allowBuilds` 授权;发私有 npm 或 `pnpm pack` tarball 无此坎。本仓库插件免构建纯 ESM,git 直装可用,发布前确认 `files` 覆盖 `lib` 和 `cordis.patch.yml`。

## 单元测试规范

用 Node 内置 test runner(`node:test` + `node:assert/strict`),零依赖、免构建,与插件"纯 ESM 直接加载"一致(上游 dsh 用 vitest,不适用本仓库)。

- **位置**:每个包 `packages/<name>/test/*.test.js`,测试与被测包同住;`files` 不含 `test`,不随包发布。
- **命令**:根 `npm test` 跑全部;单包 `npm test -w <package-name>`(或 cd 进包目录跑 `npm test`);单文件 `node --test packages/<name>/test/<file>.test.js`。
- **测真实入口**:`import * as plugin from '../lib/index.js'`(发布产物路径)。每个插件必须有一个入口测试(参照两个包的 `test/plugin.test.js`):
  - 断言 `!('default' in plugin)` 且命名导出 `name` / `apply`(有依赖的还有 `inject`)——防"default 导出丢 inject"回归;
  - 用 fake ctx(只需捕获 `tools.register` / `systemPrompt.section` / `on`)调 `apply`,断言注册的工具名与 section 齐全。真实 `defineTool` 在 `apply` 时执行,schema 违规(如缺 `additionalProperties`)在这一步就红,无需启动 dsh。
- **只 mock 昂贵/非确定性边界**(网络、时钟);指标计算、流改写、`render` / `presentCall` / `presentResult` 都是纯函数,直接喂数据断言输出。
- **waterfall 插件**(如 gateway-compat):捕获监听器后用手造 async generator 喂 chunk 流,两个方向都要断言——改写命中,且真实错误路径仍原样失败。
- **单测绿 ≠ 交付**:单测不经过 Loader 与真实组合,改完仍要走下面的验证清单。

## 验证清单(改完插件后)

1. 单元测试:`npm test -w <package-name>`(改公共约定跑根 `npm test`)——抓逻辑回归与 schema 违规;
2. 纯加载冒烟(上面的 `node -e import` 一行)——抓语法/依赖错误;
3. `--dump-config` 确认插件行在组合树里;
4. 菜单重启服务,确认 `dsh-shell.log` 出现 `serving on`(启动崩溃会记完整堆栈);
5. 行为验证:UI 里让模型调用工具,或 headless 跑一条任务;调不通时解压最新会话日志看 `tool/result` 与 `finish` 事件。
