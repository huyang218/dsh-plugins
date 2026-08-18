# shortcuts

[English](README.md) · 中文

dsh Web 客户端的键盘快捷键。所有可触达的功能注册在同一张表里:带合理默认键的开箱即用
(macOS 优先,其他平台自动把 `⌘` 换成 `Ctrl`),其余初始为「未绑定」,自己录制。绑定存在浏览器
`localStorage`,刷新和重启都不丢。

> 复制自 [Ricketts-Guo/dsh-shortcuts](https://github.com/Ricketts-Guo/dsh-shortcuts)
> (MIT,v1.1.4,commit `bf39241`),在本仓库维护。改了什么见
> [与上游的差异](#与上游的差异)。

## 功能一览

| 分组 | 功能(默认键) |
| --- | --- |
| 会话 | 新建会话 `⌘N` · 会话快速切换 `⌘K` · 归档当前会话 `⌘⇧A` · 聚焦消息输入框 `⌘⇧K` · 停止当前任务 `⌘.` |
| 视图 | 切换侧边栏 `⌘B` · 切换详情面板 `⌘⇧D` · 切换明暗主题 `⌘⇧L` · 全屏 · 滚动到顶/底部 · 聚焦会话搜索 |
| 剪贴板 | 复制最后一条助手消息 · 复制会话标题 · 复制会话 ID |
| 模型 | 选择模型 1–9 `⌘1`–`⌘9` · 思考强度 1–5 `Tab+1`–`Tab+5`(按住 Tab)· 循环思考强度 |
| 权限 | 循环切换权限——只读 / 工作区写入 / 完全访问 `⇧Tab` |
| 系统 | 打开设置 `⌘,` · 快捷键速查表 `⌘/` · 切换界面语言 |

未标注默认键的功能初始为「未绑定」,在 **设置 → 快捷键** 里点「录制」按任意组合键即可绑定。
思考强度的档位取决于当前模型,权限轮换顺序取决于部署配置的预设表。

## 安装

```sh
dsh plugin --profile web add dsh-plugin-shortcuts
```

然后重启 dsh。侧边栏底部设置按钮旁出现 `⌘K 快捷键` 按钮,说明加载成功。

## 自定义

**设置 → 快捷键**:

- **录制**——点「录制」后按任意组合键即绑定;`Backspace` 清除绑定,`Esc` 取消录制
- 每个功能可**启用/禁用**,也可一键**恢复默认**
- **冲突检测**:已被占用的组合键不允许保存
- 模型 / 思考强度行实时显示当前位置对应的真实名称

速查表(`⌘/`)底部是诊断面板:当前会话 ID、`⇧Tab` 的绑定状态、权限服务是否可用、上次权限
切换的结果、最近 12 次按键是否被插件捕获。它的用途是让你不开发者工具就能区分「没绑定」和
「绑定了但服务不在」。

## 实现要点

一张 `FEATURES` 表驱动一切——设置页、速查表、冲突检测、持久化、键盘分发全部由它派生,新增
功能只需加一条:

```js
{ id: 'stopTask', group: '会话', label: '停止当前任务',
  description: '中断正在运行的 agent 回合', defaultCombo: 'Meta+.',
  run: () => { /* 任意 client 端逻辑 */ } }
```

所有动作走 dsh 官方 client 服务(`layout` / `workspaces` / `theme` / `locale` /
`sessions` / `modelDirectories` / session projections),不依赖私有 DOM 结构——只有「打开
设置」是按语义属性定位触发按钮的。

`Tab+数字` 用「Tab 是否按住」来识别,因此裸 Tab 的正常焦点导航不受影响。

**为什么需要一个宿主半边。** 官方的权限切换走 `/permission` 斜杠命令,它的生命周期会作为
命令节点持久记进对话流——用快捷键频繁切权限就会刷屏。宿主半边因此暴露一个 loopback 路由,
直接通过命令处理器用的同一个 `permissionPresets` 服务写入,不产生对话节点。该路由会用实时
会话表校验 session id,预设合法性交给 `permissionPresets.set` 拒绝;部署没挂权限服务时它
根本不会挂载。dsh 的 Web 服务默认绑定 loopback,保持这样。

**呈现模式。** 这个插件扩展的是 Web 客户端,工具走原生调用还是 Code Mode 都不影响它。

## 与上游的差异

- 包名改为 `dsh-plugin-shortcuts` 以符合本仓库命名约定;客户端 bundle 的 loader id 必须
  与包名一致,`cordis.patch.yml` 的插件行同步改
- 补上 loader 诊断用的 `name` 导出
- 补上 `dsh.category`、`repository.directory` 和这份中英文 README
- 用标准的 `dsh plugin add` 取代 `install.sh` 引导脚本及其 shell 测试
- 测试改用 `node:test`:上游用 DOM 沙箱驱动按键、并从本机安装的 dsh 里解析 React,换台机器
  就跑不了。现在把键位解析的纯函数从 bundle 导出直接断言,并用假的 module loader 加载**发布
  产物本身**

上游的版权与 MIT 许可保留在 [LICENSE](LICENSE) 里。

## 许可证

MIT——见 [LICENSE](LICENSE)。
