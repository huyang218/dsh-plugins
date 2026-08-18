# dsh-plugins

[English](README.md) | 中文

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)(dsh)的插件仓库。
dsh 是基于 Cordis 的「一切皆插件」agent 运行框架。

这里每个包都是可安装的 dsh **组合包(bundle)**:纯 ESM、免构建,可以从 npm 装、
从 git 装,也可以直接指向源码目录一边改一边用。

## 插件

| 插件 | 分组 | 作用 |
| --- | --- | --- |
| [**astock**](packages/tools/astock) | [`tools`](packages/tools) | A 股行情数据:实时行情、K 线、技术指标,以及一次调用扫完全市场的批量筛选工具 |
| [**gateway-compat**](packages/runtime/gateway-compat) | [`runtime`](packages/runtime) | OpenAI 式网关的 SSE 流缺少 `[DONE]` 结束标记时,不让一次已经完整的回复被判为失败 |

分组(每个分组都有自己的 README,写清该形态特有的约定和坑):

- [**`tools/`**](packages/tools) —— 模型可调用的能力。
- [**`runtime/`**](packages/runtime) —— 改变 harness 自身的行为。
- [**`ui/`**](packages/ui) —— Web 客户端扩展,暂空。

## 为什么这样分

顶层按**扩展形态**分——即「这个插件对 harness 做了什么」——因为决定它怎么写、
怎么审、怎么测的正是这个维度:

- **tools** 插件注册工具、对模型可见,成败取决于 output schema;
- **runtime** 插件挂在 waterfall 扩展点上、对模型不可见,底线是绝不能把真实失败
  改写成虚假成功;
- **ui** 插件要发客户端产物,通常需要构建。

业务领域(金融、开发工具……)由包名和各自 README 体现,不进目录树,这样一个插件
不会需要归两次类。

每个分组都有自己的 README,写清该形态特有的约定和坑。

## 安装

装进 dsh profile,从 npm:

```sh
dsh plugin --profile web add dsh-plugin-astock
```

或从源码目录安装——这也是对着运行中的 profile 做开发的方式,因为装进去的是符号
链接,改完代码重启服务即可生效:

```sh
dsh plugin --profile web add ./packages/tools/astock
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

层顺序上后应用者按行胜出,并且 patch 是**整行 config 替换、不深度合并**——覆盖
别人的行时要把需要的键全部重述一遍。

## 开发

```sh
npm install                                        # 仓库根;为所有包解析 peer 依赖
npm test                                           # 全部包
npm test -w dsh-plugin-astock                      # 单个包
node --test packages/tools/astock/test/*.test.js   # 单个文件
```

测试用 Node 内置 runner(`node:test`):零测试依赖、免构建,和插件本身的加载方式
一致。测试跑的是真实发布入口(`lib/index.js`)和真实的 `defineTool`,所以 schema
违规会在单测阶段就红,而不是等到 dsh 启动时才崩。

单测绿不等于可以交付。[CLAUDE.md](CLAUDE.md) 是完整的开发规范——插件生命周期、
配置、工具编写、waterfall 扩展点、bundle 分层、测试约定,以及改完插件后的验证
清单。它写给 AI 编码 agent,但人类贡献者需要的规则完全相同。

## 贡献

1. 按扩展形态选分组,先读该分组的 README。
2. 建 `packages/<分组>/<name>/`,含 `package.json`、`cordis.patch.yml`、
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
