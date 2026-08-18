# dsh-plugins

[English](README.md) | 中文

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)(dsh)的插件仓库。
dsh 是基于 Cordis 的「一切皆插件」agent 运行框架。

这里每个包都是可安装的 dsh **组合包(bundle)**:纯 ESM、免构建,可以直接从 npm
或 git 安装。

## 插件

### `packages/tools/` — 模型可调用的能力

| 插件 | 作用 |
| --- | --- |
| [`astock`](packages/tools/astock) | A 股行情、K 线、技术指标,以及用于筛选的全市场批量工具 |

### `packages/runtime/` — 改变 harness 自身的行为

| 插件 | 作用 |
| --- | --- |
| [`gateway-compat`](packages/runtime/gateway-compat) | 兼容 SSE 流结束时缺少 `[DONE]` 的 OpenAI 式网关 |

### `packages/ui/` — Web 客户端扩展

暂空。

顶层按**扩展形态**划分,因为这才是决定插件怎么写、怎么审的维度:tools 插件注册
工具、对模型可见;runtime 插件挂在 waterfall 扩展点上、对模型不可见。业务场景由
包名和各自的 README 体现。

## 安装

```sh
dsh plugin --profile web add dsh-plugin-astock
```

或从源码目录安装(开发时对着 live profile 调试也是这条):

```sh
dsh plugin --profile web add ./packages/tools/astock
```

导出了 Schemastery `Config` 的插件,可以直接在壳应用的插件设置里配置——终端用户
不需要碰命令行。

## 开发

```sh
npm install          # 仓库根;为链接的插件提供 peer 依赖解析
npm test             # 全部包
npm test -w dsh-plugin-astock
node --test packages/tools/astock/test/indicators.test.js
```

测试用 Node 内置 runner(`node:test`),零测试依赖、免构建。

[CLAUDE.md](CLAUDE.md) 是本仓库的开发规范:插件生命周期、配置、工具编写规则、
waterfall 扩展点、bundle 分层、测试约定,以及改完插件的验证清单。它是写给 AI
编码 agent 的,但人类贡献者需要的规则完全相同。

### 新增插件

1. 建 `packages/<tools|runtime|ui>/<name>/`,含 `package.json`
   (`"name": "dsh-plugin-<name>"`、`"type": "module"`、`main` 指向 `lib/index.js`)、
   `cordis.patch.yml`、`lib/index.js`。
2. 声明组合包:`"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }`,并把
   `lib`、`cordis.patch.yml`、`LICENSE` 写进 `files`。
3. 用**命名导出** `name` / `inject` / `apply`——绝不要 default 导出,那会让
   Loader 丢掉 `inject`。
4. 加 `test/plugin.test.js`,断言导出形态与注册结果。

## 许可

MIT,见 [LICENSE](LICENSE)。
