# 插件目录

[English](CATALOG.md) | 中文

值得知道、但**不在本仓库**的插件——由各自作者维护,从各自的仓库安装。本仓库自己
维护的插件在 [README](README.zh.md) 里。

这里每一条都对着仓库核对过,只写这个插件做什么,不评价好坏。许可证一列只在**核实过**
时才填,`—` 表示没核实,不表示没有许可证。star 数是 2026-08-18 的快照。

### Web UI

| 插件 | ★ | 作用 | 许可 |
| --- | --: | --- | --- |
| [DSH-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar) | 2026 | 侧边栏完整工作台：内置文件渲染编辑、终端、Git 与子代理，支持三方插件注册新 Tab。 | — |
| [dsh-at-file](https://github.com/omdsh-dev/dsh-at-file) | 347 | Codex 风格的 `@file` 文件引用，输入框里直接搜索并引用工作区文件。 | MIT |
| [dsh-auto-collapse](https://github.com/a179-sanae/dsh-auto-collapse) | 24 | Codex 风格工作流自动折叠：回合完成收成一行「已处理 X秒」只留最终正文，工具/思考块折叠成实时摘要 chip（运行中跟随流式滚动），逐级点击展开；卸载完整还原。 | MIT |
| [dsh-annotation](https://github.com/omdsh-dev/dsh-annotation) | 72 | 选中文字→批注→随消息发送，回复按批注逐条对照。 | — |
| [dsh-navbar](https://github.com/vlln/dsh-navbar) | 38 | 对话节点导航条，右缘节点串快速跳转 user 消息。 | — |
| [ui-status-label](https://github.com/alingalingling/ui-status-label) | 38 | 把鲸鱼娘思考时的 "deep diving" 状态文案自定义成任意你想要的样子。 | MIT |

### 可观测与会话

| 插件 | ★ | 作用 | 许可 |
| --- | --: | --- | --- |
| [dsh-context](https://github.com/bowenliang123/dsh-context) | 234 | DSH 上下文洞察面板：Context 仪表盘 + /context命令 + Context 浏览器，查看 Context的分类组成、内容详情、演进趋势、压缩/注入事件、统计等一站式 Context 全生命周期管理。 | Apache-2.0 |
| [dsh-heatmap](https://github.com/283Gawin/dsh-heatmap) | 3 | DSH Web 侧边栏活动热力图：GitHub 风格网格展示每日提交、Token 用量与估算花费，今日统计行显示全会话 Token 总量、缓存命中率与按模型自动计价的花费。 | MIT |
| [dsh-whale-report](https://github.com/SenmuuuuW/dsh-whale-report) | 22 | 深迹 DeepTrace — 从会话日志生成日报/周报/月报/年报/自定义区间报告：成本与 Token 拆解、8 条确定性洞察、协作复盘、实时模型余额、PDF/PNG/HTML 导出；只读，绝不改写历史。 | — |
| [dsh-session-doctor](https://github.com/mayf3/dsh-session-doctor) | 2 | 会话医生：列出会话（含 agent 运行状态）、读取会话记录、诊断卡死的 agent、解卡（cancel + keepInbox 保留排队消息）、向其他会话发送消息。 | — |
| [dsh-backup](https://github.com/xiaoyuyu6420/dsh-backup) | 3 | 一键备份与恢复 DSH 用户数据：/backup 备份、完整性校验、恢复，定时自动备份（重启续跑），sha256 校验与自动轮换（macOS/Linux/Windows）。 | — |

### 视觉与检索

| 插件 | ★ | 作用 | 许可 |
| --- | --: | --- | --- |
| [modlens](https://github.com/liustack/modlens) | 2890 | 为纯文本模型架起视觉桥梁：粘贴图片，输出结构化 JSON 证据（OCR、版面、语义）。 | — |
| [dsh-vision-router](https://github.com/ysr666/dsh-vision-router) | 670 | 为纯文本 Agent 提供视觉能力：内置免 Key 视觉链 + 像素级视觉工具（看图问答、定位、裁剪、像素对比、取色、OCR、矢量化、抠图、截图）；粘贴图片即可用。 | — |
| [argo](https://github.com/taxueseek/argo) | 98 | 专为 agent 打造的搜索工具：多语言，覆盖中文/英文/学术/代码/购物/金融/新闻/百科。 | — |
| [dsh-browser](https://github.com/anweat/dsh-browser) | 5 | 自包含浏览器运行时：Playwright（chromium）+ OpenCLI 作为插件本地依赖（全局复用回退），提供 `browser` 服务与 9 个交互式浏览器工具。 | — |

### 金融

| 插件 | ★ | 作用 | 许可 |
| --- | --: | --- | --- |
| [dsh-quant](https://github.com/pengpengyi92/dsh-quant) | 6 | 面向 DeepSeek Harness 的量化研究工具箱，46 个工具覆盖行情、指标、因子评价、机器学习验证、风控、期权、债券与基金模拟，并提供端到端研究管线。 | — |
| [dsh-us-stocks](https://github.com/Realyujie/dsh-us-stocks) | 6 | 美股行情、历史 K 线、财务报表、分析师共识与新闻，数据来自 yahoo-finance2。 | — |
| [dsh-stock-watch](https://github.com/Awu12277/dsh-stock-watch) | 44 | A 股自选股实时行情盯盘插件：在 DeepSeek Harness（DSH）Web 界面的右上角显示一个可折叠弹窗，实时监控自选股行情、切换分组、查看分时与 K 线、设置买卖目标价。 | — |
| [capital-generation](https://github.com/v587d/capital-generation) | 2 | 中国 A 股金融数据 MCP server：11 个 fin_data__* 工具（行情/K线/财务/日历/特色数据/公告/EDB/对账/基金/指数），同花顺免费官方 REST 主干 + AKShare 兜底 + Win | — |
| [dsh-finance](https://github.com/zhang787jun/dsh-finance) | 4 | 金融研究工作流与组合风控工具，对当前市场事实强制来源与时间戳边界。 | — |

### 插件发现

| 插件 | ★ | 作用 | 许可 |
| --- | --: | --- | --- |
| [dsh-market](https://github.com/dsh-market/dsh-market) | 889 | （推荐）装在 DSH 里的插件市场：设置页内逛/搜全部社区插件，按分类筛选，确认后一键安装，已装插件一目了然。 | — |
| [dsh-plugin-mall](https://github.com/1e0zj/dsh-plugin-mall) | 2 | 开放式插件市场：GitHub dsh-plugin 话题实时搜索，逐仓库 package.json 验证（dsh.bundle/dsh.client 声明徽章与只看已验证过滤），npm 优先安装带同源防抢注校验，更新检测 | — |

### 开发

| 插件 | ★ | 作用 | 许可 |
| --- | --: | --- | --- |
| [dsh-diff-viewer](https://github.com/lehhair/dsh-diff-viewer) | 18 | PiUI 风格 diff 查看器，替换 write/edit 工具调用的默认 DiffBlock。 | — |
| [dsh-code-smell](https://github.com/lucky8197/dsh-code-smell) | 1 | 代码气味雷达：静态扫描 TODO/FIXME 债务、未实现桩、超长行、大文件与重复代码块，按严重度输出修复建议，全程只读。 | — |
| [dsh-expert-mode](https://github.com/Asher-2000/dsh-expert-mode) | 4 | 专家模式 agent preset（v0.3.0，双语双份）：首席协调官 + 11 位领域专家子代理，按任务特性自动委派。新增：三锚约束（每轮回顾/收敛/反跑题自检）+ 近距离引导（身份/任务/输出格式模板）。专家：数据 | — |
| [Aegis](https://github.com/GanyuanRan/Aegis) | 1048 | 面向编码 Agent 的软件工程方法包，提供基线优先规划、系统化调试、提示词卫生、完成前验证，以及修复/退役双轨跟踪技能。 | — |
| [MisakaNet](https://github.com/Ikalus1988/MisakaNet) | 404 | 失败恢复记忆库：从真实工程会话中搜索和记录失败恢复教训，支持 BM25 + 语义 RAG 检索和知识库管理。 | — |

### 聊天平台——用手机给 agent 下指令

下面每一个都能从聊天软件里驱动一次 agent 回合,所以一台手机就够用来派活和回答它的提问。
两个属性决定它对你是否可行:是否需要**公网回调地址**(长连接 / Stream 模式不需要,dsh 跑在
笔记本上时这一点很关键),以及接微信走的是**官方接口还是第三方协议网关**。个人微信没有官方
机器人接口——能接进去的插件都在用 iLink 这类网关,违反微信条款,账号有风险。企业微信、飞书、
钉钉、QQ 都有官方机器人。

| 插件 | ★ | 作用 | 许可 |
| --- | --: | --- | --- |
| [dsh-im](https://github.com/xmanrui/dsh-im) | 51 | 一个插件九个渠道——飞书、微信、钉钉、企业微信、QQ、Slack、Telegram、Discord、WhatsApp,扫码或机器人凭据接入。 | MIT |
| [dsh-notifier](https://github.com/THEWOLFWALKER/dsh-notifier) | 40 | 一个 `notify()` 打通 25+ 渠道(Telegram / 钉钉 / 飞书 / 企微 / QQ / Bark / ntfy / webhook…),另含远程控制。 | MIT |
| [dsh-lark](https://github.com/omdsh-dev/dsh-lark) | 32 | 飞书渠道,每个会话驱动独立 agent:工具审批、模型提问、计划审阅都以卡片回到聊天;聊天里 `/cd`、`/model`、`/new`。 | BSD-3-Clause |
| [dsh-lark-bridge](https://github.com/imetn/dsh-lark-bridge) | 7 | 飞书双向控制器,支持 Project 与 Session 路由、交互卡片、审批、附件与任务控制。 | — |
| [dsh-feishu](https://github.com/xmanrui/dsh-feishu) | 7 | 扫码把飞书机器人接进来。 | — |
| [dsh-im-bridge](https://github.com/BiBoyang/dsh-im-bridge) | 7 | 微信双向桥(iLink 网关):回合完成与审批推送、聊天内批准、长回复分段。**非官方协议**。 | — |
| [dsh-feishu-bridge](https://github.com/wz-heng/dsh-feishu-bridge) | 5 | Fail-closed 的飞书桥:白名单默认全拒、webhook 验签带时间窗与防重放、每次 bash 前可弹 Allow/Deny 卡。官方 SDK 精确锁版。 | MIT |
| [dsh-chatnode-wechat](https://github.com/Jesse-njx/dsh-chatnode-wechat) | 6 | 经 iLink 网关在微信里聊天、监控与审批。**非官方协议**。 | — |
| [telegram](https://github.com/LoserFox/telegram) | 6 | Telegram Bot API 桥接:长轮询、per-chat 会话、HTML 格式化。 | — |
| [dsh-slack](https://github.com/STARDUSTLC666/dsh-slack) | 4 | Slack 双向,走 Socket Mode——不需要公网回调。 | — |
| [dsh-dingtalk](https://github.com/STARDUSTLC666/dsh-dingtalk) | 3 | 钉钉群机器人通知(webhook + 加签,零运行时依赖)。**只出不进**。 | — |
| [dsh-discord](https://github.com/suuuuuu-1/dsh-discord) | 2 | Discord 远程控制器:私信、提及、Thread,配斜杠命令、审批与附件。 | — |
| [dsh-dingtalk-channel](https://github.com/ttmouse/dsh-dingtalk-channel) | 0 | 钉钉双向(Stream 模式):每个会话驱动一个 agent,回复经 WebSocket 回流。不需要公网回调。 | MIT |
| [dsh-wecom](https://github.com/michaelcode-wang/dsh-wecom) | 0 | 企业微信智能机器人桥:aibot WebSocket 双向(bot_id + secret)。不需要公网回调。 | MIT |
| [dsh-feishu-chat](https://github.com/Qing45/dsh-feishu-chat) | 0 | 基于飞书官方 WebSocket 长连接的双向桥,消息路由到所选工作区的最新会话。 | MIT |
| [dsh-Remote](https://github.com/Blank-not-black/dsh-Remote) | 8 | 移动远程控制套件:侧边栏入口、Bearer 令牌网关(局域网/Tailscale 自愈)、覆盖会话/审批/提问的 Android App、`/fs/*` 文件端点。 | — |
| [dsh-web-remote](https://github.com/godchen520/dsh-web-remote) | 4 | 手机访问 dsh:Cloudflare Quick Tunnel 公网链接或局域网 HTTP/HTTPS 直连(自签证书)、token 鉴权、二维码面板。 | — |

### 访问与移动端

| 插件 | ★ | 作用 | 许可 |
| --- | --: | --- | --- |
| [dsh-mobile](https://github.com/TecFancy/dsh-mobile) | 0 | DSH Web 移动端适配插件：侧边栏/详情抽屉浮层化、输入栏与设置页响应式适配，桌面零回归。 | — |
| [dsh-remote](https://github.com/flymysql/dsh-remote) | 18 | 多机远程工作区：管理多台 SSH 主机，在原生「添加工作区」流程里选本机系统文件夹或远程目录，把远程工作区镜像成真实本地文件夹并用 rw_* 工具操作。选择器是居中弹窗，默认落在本机页签，远程路径自动预填 `/` 并逐级 | — |

## 想加进这个列表

提一个 PR,同时改 `CATALOG.md` 和 `CATALOG.zh.md`。一条目录需要:仓库可访问、
一句话说明这个插件做什么、不带营销词。后续发现已废弃或不可用的会被移除。

## 为什么有的外链、有的收进仓库

列在这里的插件,从它自己的仓库安装、由它自己的作者更新。收进 `packages/` 的插件,
是本仓库接手并负责维护的——只在许可证允许时这么做,保留原作者的版权与许可,并在它的
README 里写明衍生自哪里。
