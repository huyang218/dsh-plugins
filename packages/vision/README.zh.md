# vision

[English](README.md) · 中文

让纯文本 agent 在任务中途调用多模态模型。`vision` 工具把一个图片文件发给 Qwen、Kimi、
OpenAI、Claude、Gemini 或你自己的端点,返回那个模型报告的内容——**图片本身从不进入主模型的上下文**,所以纯文本路由照常
工作,看一张图的代价是一次工具调用,而不是换模型。

> 复制自 [gloryxpnv/dsh-tool-vision](https://github.com/gloryxpnv/dsh-tool-vision)
> (MIT,v0.3.0,commit `35789ca`),在本仓库维护。改了什么见[与上游的差异](#与上游的差异)。

## 这个工具

`vision(file_path, question?)`——读取 PNG / JPEG / WebP / GIF(绝对路径或相对会话工作区),
就它向配置好的视觉模型提问。不给 question 就要求完整描述。

**结构化模式**(默认)会要求视觉模型返回固定形状的证据而不是散文,解析后是:

| 字段 | 内容 |
| --- | --- |
| `summary` | 一段总览 |
| `ocr` | 逐字转录的全部可见文字,以及按行拆分 |
| `layout` | 按阅读顺序的版面区域——标题、段落、表格、图表、表单、代码…… |
| `semantics` | 场景、命名实体(附在图中何处看到)、实体间关系 |
| `visual` | 主色、风格、备注 |
| `uncertainty` | 模型**无法确定**的东西 |

最后一项才是这个形状的意义。让视觉模型写散文,它会把读不出来的地方顺过去;给它一个明确的
「不确定项」清单,它就有地方放,而主模型可以直接引用逐字转录,而不是相信一段转述。schema
**刻意不含检测框和置信度**——视觉模型倾向于把这两样编出来。

想要纯文本回答就设 `structured: false`。

## 安装

```sh
dsh plugin --profile web add dsh-plugin-vision
```

## 服务商

选一个,填上 key。端点、线格式和起步模型 id 都跟着走:

| `provider` | 端点 | 格式 | 起步模型 |
| --- | --- | --- | --- |
| `qwen`(默认) | DashScope 兼容模式 | OpenAI | `qwen-vl-max-latest` |
| `kimi` | Moonshot | OpenAI | `moonshot-v1-8k-vision-preview` |
| `openai` | OpenAI | OpenAI | `gpt-4o` |
| `claude` | Anthropic | Anthropic | `claude-sonnet-5` |
| `gemini` | Google | Gemini | `gemini-2.5-flash` |
| `custom` | 你自己的 | 由 `protocol` 决定 | — |

支持三种线格式,因为它们确实不一样:OpenAI 打 `/chat/completions`,图片是 `data:` URI,
用 bearer token;Anthropic 打 `/messages`,图片是 base64 的 `source` 块,用 `x-api-key`
头并且**必须**带 `anthropic-version`;Gemini 打 `/models/<id>:generateContent`,图片是
`inline_data`,用 `x-goog-api-key`。起步模型 id 只是起点,不是对你账号权限的断言——按你的
key 实际能用的模型改 `model`。

```yaml
- id: vision
  config:
    provider: kimi
    apiKey: '…'
```

自建或本地服务用 `provider: custom`,自己填 `baseURL` / `model` / `protocol`;**本机回环
端点不需要 key**,所以 LM Studio 跑在 `http://127.0.0.1:1234/v1` 时 `apiKey` 留空即可。

这条路线补齐之前,插件**不注册任何工具**,并在系统提示词里明确告诉模型:它看不了图、还缺
什么——而不是留一个必然失败的工具在那里。日志里也会说同一件事,否则你只会看到「这插件没反应」。

> [!IMPORTANT]
> 插件会**在模型需要之前**就把端点和模型名写进系统提示词,并要求它:调用失败就如实报告,
> 不要去描述一张自己没看到的图。否则模型会在调用失败后**照着文件名编**——这和金融插件必须
> 事先声明凭证是同一个教训。

失败信息会点名打的是哪里:`vision: request to http://127.0.0.1:1234/v1 failed (…)`、
带端点自身响应体的 HTTP 状态码、或点名模型的「返回了空回答」。

## 桥接服务

插件还提供一个可选的 `vision-bridge` 服务。工具是**agent 主动**去看某个文件;桥接管的是
**用户**往纯文本会话里粘贴的图片:在每个图片部件后面补一段描述,让这条提示词能被受理。任何
环节失败它都返回空,宿主保留原本的拒绝——拒绝好过编一段描述。

- `autoDescribe: true`(默认)在受理时就调用视觉模型,模型要多久就等多久。
- `autoDescribe: false` 保留缩略图并把模型指向工作区里的那个文件,由模型在真正需要看时再调
  `vision`——一次有意的调用,而不是一次自动调用加一次追问。
- `keepThumbnail` 需要宿主的纯文本序列化器会在出网前丢掉图片块。出厂宿主会拒绝纯文本路由上
  的图片内容,所以保持关闭。

## 配置

| 键 | 默认值 | 决定什么 |
| --- | --- | --- |
| `provider` | `qwen` | 由谁来看图,以及随之而来的端点与格式 |
| `apiKey` | *(空,非本机必填)* | 该服务的凭证 |
| `baseURL` | *(空,= provider 的地址)* | 端点根地址;`custom` 时必填 |
| `model` | *(空,= provider 的起步模型)* | 视觉模型 id |
| `protocol` | `openai` | 线格式,**仅** `provider: custom` 时生效 |
| `structured` | `true` | 要固定形状的证据而不是散文 |
| `maxTokens` | `8192` | 输出预算——推理型模型会先花掉一部分在思考上 |
| `timeoutMs` | `180000` | 单次请求的墙钟时间 |
| `maxImageBytes` | `50 MiB` | 接受的最大图片 |
| `autoDescribe` | `true` | 桥接是否在受理时就调用模型 |
| `keepThumbnail` | `false` | 桥接是否在历史里保留图片块 |

## 与上游的差异

- 包名改为 `dsh-plugin-vision` 以符合本仓库命名约定,插件行与导出的 `name` 同步
- **支持 Claude、Gemini 与 OpenAI 格式的服务商**。上游只会说一种线格式;三者在端点路径、
  鉴权头、图片编码方式上都不同,所以各自是一张小表,插件其余部分与协议无关
- **用服务商预设取代写死的端点**。上游内置本机 LM Studio 的地址与模型 id,这在没装 LM Studio
  的机器上意味着把图片发给那个端口上恰好在听的任何东西。现在服务商自带端点与格式,唯一必填的
  是 key,没有 key 就不注册任何东西并在提示词里说明
- **失败信息点名它真正打的端点**。上游无论 `baseURL` 配成什么都说 "LM Studio request
  failed",指向别的服务时会误导所有人
- **工具声明了 `timeoutMs`**,并高于它自己的请求上限,这样慢端点会带着原因失败,而不是被
  超时策略掐断后不留线索
- **能力在系统提示词里事先声明**,而不是靠调用失败去发现
- 补上 `dsh.category`、`repository.directory` 和这份中英文 README
- 测试改用 `node:test`,覆盖 JSON 回收、证据归一化,以及经由假端点走通的每条失败路径

上游的版权与 MIT 许可保留在 [LICENSE](LICENSE) 里。

## 许可证

MIT——见 [LICENSE](LICENSE)。
