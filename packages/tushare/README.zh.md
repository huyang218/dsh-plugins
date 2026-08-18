# dsh-plugin-tushare

[English](README.md) | 中文

本仓库金融插件共用的 [Tushare Pro](https://tushare.pro) 接入。它提供 `tushare` 服务,
**不注册任何工具**——模型不会直接调用它。

装一次、配一次 token,所有金融插件共用。

```sh
dsh plugin --profile web add dsh-plugin-tushare
```

```yaml
- id: tushare
  config:
    token: '你的 tushare token'
```

## 为什么要一个共享 provider

每个金融插件当然可以各带一个 token 字段,但那样用户要把同一个 token 粘四遍;更要命的
是——**Tushare 按账号计量配额**,而四个插件各算各的限流,四个都"守规矩"地压着上限,
合起来照样超。

一个服务意味着一份 token、一个配额闸、一份交易日历。

## Tushare 是免费的吗

Tushare Pro 账号免费注册,但**接口按积分开放**,积分来自注册、活跃或付费。大致是:

| 档位 | 本仓库用到的接口 |
| --- | --- |
| `basic` —— 入门账号即可 | `trade_cal`、`stock_basic`、`daily` |
| `points` —— 需要更高积分 | `daily_basic`、`income`、`balancesheet`、`cashflow`、`fina_indicator`、`express`、`moneyflow`、`top_list`、`hsgt_top10`、`moneyflow_hsgt`、`cb_basic`、`cb_daily`、`stk_holdernumber` |

这些门槛 Tushare 会调整,所以上表是**说明,不是判据**。真正权威的是你拿到的报错——
它写着当前的积分要求。`ctx.tushare.access(apiName)` 返回档位,便于工具提前提示。

## 失败时告诉 agent 什么

Tushare 对**每一次**调用都返回 HTTP 200、把失败写在 body 里,而且三个毫不相干的问题
都以同一个 `code: 40203` 出现。本客户端把它们分开,因为处置方式完全相反:

| 类型 | 含义 | agent 应该做什么 |
| --- | --- | --- |
| `no-token` | 未配置,或 token 被拒 | 让用户去设置一个有效的 token |
| `access-denied` | token 积分不够,访问不了这个接口 | **如实上报**——重试和换措辞都没用 |
| `rate-limited` | 每分钟配额用尽(已退避重试过) | 等一会,或收窄请求范围 |
| `provider-error` | Tushare 拒绝了这个请求本身 | 通常是参数错,属于 bug |
| `transport` | 请求根本没拿到应答 | 网络问题,重试可能有用 |

`access-denied` 与 `no-token` 的文案会**明确要求 agent 不得替换或编造数据**。这句话
之所以存在,是因为反面情形被真实观察到过:只被告知"数据不可用"时,agent 从别处凑出
数字,然后自信地给了答案。接口不可用必须**终止任务**,而不是改道绕行。

## 服务接口

```ts
ctx.tushare.configured                      // boolean:配了 token 吗?
ctx.tushare.access(apiName)                 // 'basic' | 'points' | undefined
ctx.tushare.query({ apiName, params, fields, signal })   // → 行数组,失败抛 TushareError
ctx.tushare.tradeDates({ endDate, count, signal })       // → ['20260810', …] 升序
```

消费方声明 `inject: ['tools', 'systemPrompt', 'tushare']`,沿用 dsh 自身能力的
provider/consumer 拆分方式(`dsh-bash-local` + `dsh-tool-bash`)。它们需要本插件已安装
才会加载。

窗口按**交易日**计数,取自交易所日历——日历算术没法告诉你某个周一是不是休市。

## 许可

MIT
