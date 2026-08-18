# dsh-plugin-astock

[English](README.md) | 中文

给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的 A 股数据工具。

单只股票的行情、K 线与技术指标,加上用于筛选的**全市场批量工具**。数据来自东方财富
公开接口;配上 [Tushare Pro](https://tushare.pro) token 后,还能取基本面、财务报表、
资金流向与可转债。

## 安装

```sh
dsh plugin --profile web add dsh-plugin-astock
```

这样就有了全部免费工具。装上共享的 provider 并配好 token 后,Tushare 那部分工具才会出现:

```sh
dsh plugin --profile web add dsh-plugin-tushare
```

```yaml
- id: tushare
  config:
    token: '你的 tushare token'
```

token 存在 provider 上而不是这里,所有金融插件共用一份 token 和一份配额。Tushare 收费
情况与权限失败时会告诉 agent 什么,见 [dsh-plugin-tushare](../tushare)。

## 工具

免费工具完全不需要凭证;其余需要 Tushare token,而且**每个工具都在自己的描述里写明**——
这样模型能在有免费替代时选免费的,没有时如实告诉你缺什么。

| 工具 | 费用 | 作用 | 免费替代 |
| --- | --- | --- | --- |
| `astock_quote` | 免费 | 单只实时行情 | — |
| `astock_data` | 免费 | K 线:日/周/月/分钟,可复权 | — |
| `astock_indicators` | 免费 | K 线 + MA/MACD/RSI/KDJ/BOLL/OBV/WR/ATR/DMI 一次算完 | — |
| `astock_search` | 免费 | 按代码、名称或拼音搜股票 | — |
| `astock_market_quotes` | 免费 | **全市场**实时快照 | — |
| `astock_fundamentals` | Tushare | 每日估值:市盈率、TTM、市净率、市销率、股息率、市值 | `astock_quote` 只有市盈率和市值 |
| `astock_market_bars` | Tushare | **全市场**日线窗口 | `astock_data`,一次一只 |
| `astock_financials` | Tushare | 利润表、资产负债表、现金流量表、主要指标(按报告期) | 无 |
| `astock_moneyflow` | Tushare | 个股按单量的资金流、北向资金、龙虎榜 | 无 |
| `astock_convertible_bonds` | Tushare | 全部可转债,含转股价值与转股溢价率 | 无 |

Tushare 按积分开放接口,所以**有效的 token 也未必能访问全部接口**。被拒时返回的是
写明积分要求的权限错误——插件原样透传,而不是当作「没有数据」,并且要求模型如实上报
而不是改用别的来源。

## 筛选需要 Code Mode

两个 `astock_market_*` 工具的答案是整个市场的数据集,存在规范值里,`render` 只返回摘要——
几千行绝不能以文本形式进入模型上下文。因此这些数据只能在 `run_code` 程序里访问:

```ts
const { codes, rows, fields, tradeDates } = await tools.astock_market_bars({
  endDate: '20260814', days: 40,
})
// rows[i] 打包了 codes[i] 的全部 K 线:K 线之间用 ";" 分隔,字段之间用 "," 分隔
```

它们会**拒绝模型的直接调用**并说明改用 run_code:直接调用只能拿到摘要,而据摘要
猜出来的筛选结果比没有结果更糟。

扫描发生在工具内部,所以成本是 O(交易日数) 而不是 O(股票数):40 天的全市场窗口约 40 次
请求、几秒钟;逐只抓取则是几千次请求,而且会被限流。

## 数据口径

- `astock_market_bars` 的 K 线是**不复权**的。
- 缺失的指标是**整个键不存在**,绝不是 `0` 或 `NaN`——东方财富用 `'-'`、Tushare 用 `null` 表示缺失。
- 东方财富的实时全市场列表不可用时,快照会降级到延时源并置 `delayed: true`,筛选结果因此
  可以声明自己用的是延时价。

## 许可

MIT
