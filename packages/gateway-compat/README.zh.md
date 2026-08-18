# dsh-plugin-gateway-compat

[English](README.md) | 中文

给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 用的第三方
OpenAI 式网关兼容层。

有些网关在最后一个内容块之后直接结束 SSE 流,不发 `data: [DONE]` 哨兵。适配器会如实
把它报成 `STREAM_CLOSED`,于是一次**已经完整送达**的回复被判成失败的一轮。本插件包装
`llm/stream` waterfall,把这一种终止错误改写成正常的 `stop`。

而且**仅当**确实已经收到正文、且没有工具调用正在进行中时才改写——所以真正的中途断流
和被截断的工具调用仍然响亮地失败,并保留重试资格。

## 安装

```sh
dsh plugin --profile web add dsh-plugin-gateway-compat
```

无需配置。它不注册任何工具,对模型不可见。

## 许可

MIT
