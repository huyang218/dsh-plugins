<div align="center">

# dsh-plugins

**[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)(dsh)的插件仓库** ——
dsh 是基于 Cordis 的「一切皆插件」agent 运行框架。

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Build-free ESM](https://img.shields.io/badge/build-none-brightgreen.svg)](#开发)
[![Tests: node:test](https://img.shields.io/badge/tests-node%3Atest-informational.svg)](#开发)

[English](README.md) · 中文

</div>

---

这里每个包都是可安装的 dsh **组合包(bundle)**:纯 ESM、免构建,可以从 npm 装、
从 git 装,也可以直接指向源码目录一边改一边用。

## 插件

| 插件 | 分组 | 作用 | 凭证 |
| --- | --- | --- | --- |
| [**astock**](packages/astock) | [`tools`](docs/authoring-tools.md) | A 股数据面:行情、K 线、指标、全市场筛选、财务报表、资金流向、可转债 | 免费,部分工具需 Tushare |
| [**ainfo**](packages/ainfo) | [`tools`](docs/authoring-tools.md) | A 股信息面:新闻、券商研报、业绩预告、分红、股东增减持、十大股东 | 需 Tushare token |
| [**aportfolio**](packages/aportfolio) | [`tools`](docs/authoring-tools.md) | 跨会话记住你的持仓与自选,实时取价,给出盈亏、占比与目标价触发 | — |
| [**astock-chart**](packages/astock-chart) | [`ui`](docs/authoring-ui.md) | 把 `astock_data` 的结果直接画成带成交量的 K 线图,就在回复里 | — |
| [**tushare**](packages/tushare) | [`runtime`](docs/authoring-runtime.md) | 共享的 Tushare Pro 接入:一个 token、一个配额闸、一份交易日历,以及 Agent 能据以行动的错误分类 | — |
| [**tool-health**](packages/tool-health) | [`runtime`](docs/authoring-runtime.md) | 跨会话记住哪些工具在失败,并在下一次会话开始前就告诉模型 | — |
| [**tool-usage**](packages/tool-usage) | [`runtime`](docs/authoring-runtime.md) | 计量一次会话在工具上的花费:调用次数、耗时分位数、失败率,并可设预算提醒 | — |
| [**tool-retry**](packages/tool-retry) | [`runtime`](docs/authoring-runtime.md) | 对可自行恢复的工具失败做重试(socket 重置、限流、超时),只针对声明为可安全重复的工具 | — |
| [**gateway-compat**](packages/gateway-compat) | [`runtime`](docs/authoring-runtime.md) | OpenAI 式网关的 SSE 流缺少 `[DONE]` 结束标记时,不让一次已经完整的回复被判为失败 | — |

**想找本仓库没有的插件?** [CATALOG.zh.md](CATALOG.zh.md) 按分类列出了由他人维护的
插件,以及每个插件做什么。

> [!NOTE]
> 金融插件通过 `tushare` provider 共用一份凭证,而不是各自向用户要同一个 token。
> 每个需要凭证的工具都**在自己的描述里写明**——这样模型能在有免费替代时选免费的,
> 在没有时如实告诉用户缺什么。

## 安装

装进 dsh profile,从 npm:

```sh
dsh plugin --profile web add dsh-plugin-astock
```

或从源码目录安装——这也是对着运行中的 profile 做开发的方式,因为装进去的是符号
链接,改完代码重启服务即可生效:

```sh
dsh plugin --profile web add ./packages/astock
```

启动前先确认它进了组合树:

```sh
dsh --profile web --dump-config      # 看插件对应的那一行
```

## 配置

导出了 Schemastery `Config` 的插件不需要用户碰命令行:桌面壳会在安装时按 schema
渲染表单。值最终落成 profile 的 `cordis.patch.yml` 里一条按 id 定向的覆盖,你也
可以手写:

```yaml
- id: astock
  config:
    tushareToken: '你的 token'
```

> [!IMPORTANT]
> 层顺序上后应用者按行胜出,并且 patch 是**整行 config 替换、不深度合并**——
> 覆盖别人的行时要把需要的键全部重述一遍。

## 开发

```sh
npm install                                        # 仓库根;为所有包解析 peer 依赖
npm test                                           # 全部包
npm test -w dsh-plugin-astock                      # 单个包
node --test packages/astock/test/*.test.js   # 单个文件
```

测试用 Node 内置 runner(`node:test`):零测试依赖、免构建,和插件本身的加载方式
一致。测试跑的是真实发布入口(`lib/index.js`)和真实的 `defineTool`,所以 schema
违规会在单测阶段就红,而不是等到 dsh 启动时才崩。

> [!TIP]
> 单测绿不等于可以交付——它不经过 Loader,也不经过真实组合。

[CLAUDE.md](CLAUDE.md) 是完整的开发规范——插件生命周期、
配置、工具编写、waterfall 扩展点、bundle 分层、测试约定,以及改完插件后的验证
清单。它写给 AI 编码 agent,但人类贡献者需要的规则完全相同。

## 贡献

1. 按要做的东西读对应指南:[tools](docs/authoring-tools.md)(模型可调用的能力)、
   [runtime](docs/authoring-runtime.md)(waterfall 包装与共享服务)、
   [ui](docs/authoring-ui.md)(Web 客户端扩展)。
2. 建 `packages/<name>/`,含 `package.json`(含 `dsh.category`)、`cordis.patch.yml`、
   `lib/index.js`、`README.md`、`LICENSE`。
3. 用**命名导出** `name` / `inject` / `apply`。default 导出会让 Loader 丢掉
   `inject`,而它失效后的表现完全不像是导出方式引起的,很难查。
4. 加 `test/plugin.test.js`,覆盖导出形态和全部注册。
5. 跑 `npm test`,并走一遍 CLAUDE.md 里的验证清单。

有四处名字容易混:

| 位置 | 值 | 用途 |
| --- | --- | --- |
| `package.json` 的 `name` | `dsh-plugin-astock` | npm 包名 |
| `lib/index.js` 导出的 `name` | `astock` | Loader 诊断用的短名,不带前缀 |
| `cordis.patch.yml` 的 `id` | `astock` | 组合树里的行 id,配置覆盖按它定向 |
| `cordis.patch.yml` 的 `name` | `dsh-plugin-astock` | 按包名引用,不是路径 |

## 许可

MIT,见 [LICENSE](LICENSE)。
