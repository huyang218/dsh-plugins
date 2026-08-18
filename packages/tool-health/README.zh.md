# dsh-plugin-tool-health

[English](README.md) | 中文

记住哪些工具一直在失败——**跨会话**——并在下一次会话开始干活之前就告诉模型。

agent 撞上一个已经挂掉的端点,学习方式是最贵的那种:一次一个失败调用,发生在任务
中途,而且往往连着好几个会话重复发生。本插件把这件事变成模型**事先被告知**的信息。

```sh
dsh plugin --profile web add dsh-plugin-tool-health
```

不需要配置。它**不注册任何工具**,对模型来说只多了一段提示词——而且一切正常时那段
是空的。

## 它做什么

监听 `tools/result`(emit 模式的观测点,所以它**改不了**工具的返回),为每个工具记一份
账:总调用数、失败数、当前连续失败次数、最后一次错误,以及上次成功是什么时候。记录
通过 storage 域持久化,因此比会话活得久。

某个工具最近反复失败时,下一次提示词里会带上:

```
Recent tool failures (observed in this and earlier sessions, newest first):
- astock_market_quotes: 4 consecutive failures, latest 2 分钟前 (last succeeded 3 小时前)
  last error: UND_ERR_SOCKET: fetch failed
This is evidence from past calls, not a prohibition: the cause may have cleared.
...do not substitute or invent data.
```

## 它做的三个判断

**看连续失败,不看失败率。** 五十次里错一次的工具是健康的,连着错三次的不是。失败率
分不出这两者,而且一次早已恢复的故障留在分母里越久,数字只会越难看。

**失败会过期。** 上周的故障说明不了这个会话的事,继续提醒等于教模型躲开一个其实已经
可用的工具。默认记忆 24 小时(`forgetAfterHours`)。

**健康时保持沉默。** 报告返回空串,对提示词零贡献。常驻一句"所有工具正常"是在每次
请求上花 token 说废话。

## 配置

| 键 | 默认 | 含义 |
| --- | --- | --- |
| `unhealthyAfter` | `2` | 连续失败多少次才上报 |
| `forgetAfterHours` | `24` | 多久之前的失败不再提 |
| `maxTools` | `200` | 记录上限,超出淘汰最久未更新的 |
| `maxListed` | `8` | 一次报告最多点名几个工具 |

持久化是可选的:没有组装存储后端时,插件仍在单个会话内工作,而不是拒绝加载。

## 许可

MIT
