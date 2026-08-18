# dsh-plugin-ainfo

[English](README.md) | 中文

A 股**信息面**工具:关于一家公司**被说了什么**,而不是它成交在什么价位。

行情、指标与筛选在 [`dsh-plugin-astock`](../astock)。两者分开是因为问题域不同——
筛选 40 日最低价用不到这些,而每个注册的工具都会在**每次请求**里占用系统提示词预算。

## 安装

本插件与持有 token 的共享 provider 都要装:

```sh
dsh plugin --profile web add dsh-plugin-ainfo
dsh plugin --profile web add dsh-plugin-tushare
```

```yaml
- id: tushare
  config:
    token: '你的 tushare token'
```

> [!NOTE]
> 它的结果卡片依赖 `presentationMeta` 投影,而 `run_code` 内部分发的调用拿不到它。
> 纯 Code Mode 预设下答案不受影响,但卡片会退回通用卡片——见
> [工具呈现模式](../../docs/presentation-modes.zh.md)。

## 工具

**这里的每个工具都需要 Tushare token,且没有免费替代**——这类数据没有稳定可用的公开
接口。每个工具都在自己的描述里写明,所以模型能告诉你缺什么,而不是调用到一半才发现。

| 工具 | 返回什么 |
| --- | --- |
| `ainfo_news` | 时间窗口内的重要新闻:标题、来源、时间戳、纯文本摘要 |
| `ainfo_research` | 券商研报:评级、目标价、机构与作者——可查单只,也可查某个报告日的全市场 |
| `ainfo_events` | 公司披露,按 `kind` 区分:`forecast`(业绩预告)、`dividend`(分红)、`holdertrade`(股东增减持)、`float`(限售解禁)、`holders`(十大股东) |

Tushare 按积分开放接口,有效 token 也可能被拒。拒绝信息里写明了积分要求,并作为权限
错误透传;各类失败的含义见 [dsh-plugin-tushare](../tushare)。

## 本插件坚持的两条

**文本原样透传。** 标题、研报名、披露摘要都不由插件改写,这样模型才能引用原文。新闻正文
是唯一例外——源数据带 HTML,所以摘要会被剥成纯文本并截断,而且**明确标注是摘要**,不能
当作全文。

**评级是观点。** `ainfo_research` 汇总评级分布与目标价区间,并在输出里声明这些是券商的
看法、引用时要注明机构,不能当作事实陈述。

## 许可

MIT
