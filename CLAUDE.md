# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 这个仓库是什么

DeepSeek Harness(dsh)的插件 monorepo,**面向开源发布**(MIT)。dsh 是"一切皆插件"的 agent 运行框架(基于 Cordis)。

目录**一层平铺**:`packages/<名字>/`,一个插件一个目录。这不是审美选择——**生态的扫描器只认这一层**(插件目录站、应用内市场都按 `packages/<name>/package.json` 抓取;官方目录 1342 个插件里,子路径两层的是 0 个),嵌得更深的仓库根本不会被发现。

分组改由 **`package.json` 的 `dsh.category`** 承载,写法 `<组>/<领域>`:

```
tools/…      模型可调用的能力(注册工具,对模型可见)      astock(数据面)、ainfo(信息面)
runtime/…    对模型不可见:waterfall 包装与共享服务       gateway-compat、tushare、tool-health、tool-usage
ui/…         Web 客户端扩展                            astock-chart
```

三种形态各自的约定和坑写在 `docs/authoring-{tools,runtime,ui}.md`;**工具呈现模式**(native / code / both)对插件的连带影响写在 `docs/presentation-modes.md`(中英双份)——模式由 agent 预设按 scope 选定一次、覆盖会话里的**所有**工具,`presentAs` 一个组合只能声明一种,所以为某个插件选的模式会改变其他所有插件的调用方式。合规检查会强制:投影 `presentationMeta` 或 `ui/` 分类的包,两份 README 都要说明模式对它的影响。业务场景由包名和各自 README 体现。客户定制组合不放在这个公开仓库里。

- 参考文档:dsh 源码仓库在 `~/Documents/code/open/deepseek-harness`,插件开发看 `docs/user/develop/`(入门)、`docs/cookbook/adding-a-tool.md`(工具进阶)、`docs/cookbook/extension-cookbook.md`(扩展形态)、`docs/architecture.md`(扩展点总表)。
- 本机的 dsh 以桌面壳应用 "dsh Desktop.app" 运行(壳项目在 `~/Documents/code/alpha/dsh-desktop`,原名 dsh-shell,已装到 `/Applications`)。改壳代码后要重新打包并部署:`npx electron-builder --mac dir` → 退出应用 → `ditto dist/mac-arm64/"dsh Desktop.app" /Applications/`(菜单的"重启服务"只重启 dsh 服务进程,不加载新的壳代码)。
- 壳提供**安装期配置表单**:插件导出 Schemastery `Config` 时,插件管理里安装完会自动弹表单(也可随时点"设置"),值写进 profile 的 `plugin-config.json` 并镜像成 `cordis.patch.yml` 里带标记的托管块。给用户的插件要可配置,就导出 `Config`,不要让用户碰命令行。

## 本机运行环境(重要,和标准安装不同)

- `DSH_HOME` = `~/Library/Application Support/dsh-desktop/dsh-home`(不是默认位置)。
- dsh 运行时(npm 安装的 `@deepseek-ai/dsh`)在 `~/Library/Application Support/dsh-desktop/runtime/slot-a|slot-b`,CLI 入口:`node "<slot>/node_modules/@deepseek-ai/dsh/lib/bin.js"`。命令行操作 profile 前必须 `export DSH_HOME` 为上述路径。
- 改插件代码后:通过应用菜单栏 `dsh → 重启服务`(或托盘菜单)生效;插件是 `link:` 链接,无需重装。
- 服务/启动日志:`~/Library/Application Support/dsh-desktop/dsh-desktop.log`。会话日志(调试模型可见行为的事实来源):`$DSH_HOME/sessions/**/session.jsonl.zstd`,用 `zstd -dc` 解压看事件流。
- 模型走 tokenhub.tencentmaas.com 网关(OpenAI 兼容,但不发 SSE `[DONE]`):`packages/gateway-compat` 插件与 home 级补丁 `$DSH_HOME/cordis.patch.yml` 里的 `llm-deepseek` retryPolicy(含 `STREAM_CLOSED`)共同兜底。改动网关相关行为前先读这两处。

## 常用命令

```sh
npm install                       # monorepo 根;为 link: 插件提供 peer 依赖解析
npm test                          # 全部单元测试;单包:npm test -w dsh-plugin-<name>
export DSH_HOME="$HOME/Library/Application Support/dsh-desktop/dsh-home"
BIN="$HOME/Library/Application Support/dsh-desktop/runtime/slot-a/node_modules/@deepseek-ai/dsh/lib/bin.js"
node "$BIN" plugin --profile web add ./packages/<name>         # 安装插件到 web profile
node "$BIN" plugin --profile web remove <package-name>     # 卸载
node "$BIN" --profile web --dump-config                    # 不启动,验证组合树里的插件行
node "$BIN" --profile headless "任务描述"                   # 端到端验证(走真实模型,消耗 API 额度)
node -e "import('<abs>/packages/<name>/lib/index.js').then(m => console.log(Object.keys(m)))"  # 纯加载冒烟
```

## 插件结构约定

每个 `packages/<name>/`:

```
package.json      # name 为 dsh-plugin-<name>;"type": "module";main 指向 lib/index.js
cordis.patch.yml  # bundle 配置层:- insert: [{ id: <name>, name: dsh-plugin-<name> }]
lib/index.js      # 插件入口(纯 ESM JS,运行时不经构建直接加载)
```

**三处名字各不相同,别混**(上游 dsh 的写法为准):

```
package.json 的 name    dsh-plugin-astock   # npm 包名,带前缀
lib/index.js 导出的 name astock             # 短名,不带前缀 —— Loader 诊断用
cordis.patch.yml 的 id  astock             # 组合树里的行 id,配置覆盖按它定向
cordis.patch.yml 的 name dsh-plugin-astock  # 按包名引用,不是路径
```

- `package.json` 必须声明 `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }`,`files` 包含 `lib` 和 `cordis.patch.yml`。
- 用到的 dsh 包(`@deepseek-ai/dsh-tools` 等)写进 `peerDependencies`;monorepo 根的 `npm install` 负责让符号链接位置能解析到它们。不要在单个插件目录里建 node_modules。
- 开源包元数据:`dsh.category`(分组靠它,不靠目录)、`license: MIT` + 各包自带 `LICENSE`(进 `files`)、`repository.directory` 指到包目录、`keywords` 含 `dsh-plugin`(插件市场靠它发现)、`dsh.category` 写 `tools/finance` 这类分类。**不要写 `private: true`**——本仓库插件免构建纯 ESM,发 npm 后用户一键安装无需构建授权(git 直装则要求用户在 `pnpm-workspace.yaml` 里 `allowBuilds`)。
- 每个插件包必须有 **`README.md` 与 `README.zh.md` 两份**、互相链接,且 `README.zh.md` 要写进 `files`(npm 只自动带 README.md)。英文是 npm 页面,而本仓库的用户多数读中文——只发其中一份,总有一半人读到的是错的那份。合规检查会强制这一条。

## 现有插件(改动前先读对应入口)

- **astock**:A 股数据工具。分层:`lib/data.js`(东方财富单只行情/K 线,代码归一化 0=深/1=沪/2=京)、`lib/market.js`(东方财富全市场快照)、`lib/tushare.js`(Tushare Pro:基本面 + 按交易日的全市场日线 + 交易日历)、`lib/indicators.js`(纯函数指标 MA/MACD/RSI/KDJ/BOLL 等)、`lib/value.js`(规范值数值助手)、`lib/index.js` 只做工具注册与格式化输出。它是本仓库 `defineTool` 完整形态的参考实现:parameters、output.schema、`render`(模型可见文本)、`presentationMeta` / `presentCall` / `presentResult`(UI 卡片)、`timeoutMs`、`isConcurrencySafe`,以及每个工具配套的 `ctx.systemPrompt.section`。
  - 单只:`astock_data` / `astock_indicators` / `astock_quote` / `astock_search`;配了 Tushare token 才注册 `astock_fundamentals`。
  - **批量(筛选类需求走这里)**:`astock_market_quotes`(全市场实时快照,免 token)、`astock_market_bars`(全市场日线窗口,需 token)。设计要点:**扫描在工具内部完成,复杂度 O(天数) 而非 O(股票数)**——逐只抓 2800 次会被数据源限流(踩过),而按交易日批量取 40 天只需 40 次请求、约 2 秒拿到 22 万根 K 线。规范值是给 Code Mode 用的程序化数据(大结果按下一条打包),`render` **只返回摘要**(几千行绝不能进模型上下文),筛选逻辑由模型在 Code Mode 里写 JS 完成,这样"最低价小数点后两位相同"这种任意条件无需插件预设参数。
  - **摘要截断了就要说出来**(踩过两次):render 只展示前几条时,必须写明"共 N 条,全部在规范值 X[] 里",否则模型会把这几条当成全部来回答。`test/spec-compliance.test.js` 会对所有列表型工具自动校验这一条。
  - **纯摘要的工具必须拒绝模型直接调用**(踩过两次的同一个洞):`both` 模式下模型**可以**原生调用它们,拿到的只有摘要、没有数据,于是又会去编造。`exec.parent` **仅在 run_code 子调用时存在**,据此判断并抛错,错误信息要写清"改用 run_code"以及"拿不到就如实说、别拼凑"。单只查询类工具不要加这个守卫——它们的 render 本来就是完整答案。
  - **大结果必须打包(踩过,会崩服务)**:Code Mode 的每次 `run_code` 跑在一个 `maxOldGenerationSizeMb: 512` 的 worker 里,绑定返回值跨 port 时会被逐个数组 `Reflect.ownKeys` 校验并**整体重建一份脱附副本**。667k 个 bar 对象(全市场 × 120 天)光重建就 313MB,直接把整个 dsh 服务 OOM abort 掉(`signal=SIGABRT`)。所以 `astock_market_bars` 的规范值是 `{ tradeDates, codes, fields, count, rows }`——`rows[i]` 把 `codes[i]` 的全部 K 线打包成一个字符串(`;` 分隔,每根为 `di,open,high,…`,`di` 是 `tradeDates` 下标)。字符串是共享引用,脱附几乎免费:同样 667k 根,常驻 32MB、跨界后 62MB。新增批量工具照此办理,并配 `marketMaxBars` 这类预算,超了**在探测请求后就报错**要求收窄窗口,别等整窗抓完。
  - **东方财富的可用性是按端点的**(踩过):2026-08 起 `push2.eastmoney.com/api/qt/clist/get`(全市场列表)**直接关连接**——不是 HTTP 状态码,是 socket 被关,undici 报 `fetch failed / UND_ERR_SOCKET`;而同一主机的 `/api/qt/stock/get`(单只)正常,`1.push2`、`82.push2`、`push2his` 的 clist 同样不可用,只有 `push2delay.eastmoney.com` 还服务(延时行情,字段与 total 完全一致)。所以全市场列表走**主机回退链**(`MARKET_HOSTS`,首个有数据的赢),并把 `delayed` 放进规范值和摘要——降级到延时数据必须让模型看得见。第一页为空视为「该主机不服务」而非空市场:静默返回 0 只会让筛选给出「无匹配」这种错误答案,而不是可见的失败。
  - **Tushare 配额按接口计**(踩过):`daily` 是 500 次/分钟,而一次全市场窗口 = 每个交易日一次请求,所以 120 天的调用重复三四次就会中途报「频率超限」把整个工具call 打挂。三层应对:`createRateLimiter`(按 apiName 的滑动窗口,配额内排队而不是失败)、`tushareQuery` 对配额报错重试退避(token 可能被别处共用)、以及**收盘日缓存**——已收盘交易日的日线永不变化,重复窗口零请求(实测 120 天冷取 1.4s/120 请求,热取 0.15s/0 请求)。缓存容量必须 ≥ 窗口天数,否则 LRU 自我淘汰、命中率为 0。
  - **凭证要事先声明,不能靠失败发现**(用户明确要求):`astock:data-sources` section **无条件注册**(即使 provider 没装),说明哪些工具免费、哪些要 token、工具缺席或报权限错时该怎么办;每个 Tushare 工具的 description 再用 `tokenNote()` 重复一遍,并写明免费替代(如 astock_fundamentals ↔ astock_quote)。目的是让模型**调用前**就能判断走哪条路。
  - Tushare 工具走**嵌套 `ctx.inject(['tushare'], ...)`**,不是顶层 inject:顶层声明会让没装 provider 的用户连免费的东财工具都用不上。
  - 缺失值铁律:东方财富用 `'-'`、Tushare 用 `null` 表示缺失,而 `Number(null) === 0`——一律走 `lib/value.js` 的 `finiteNumber` / `assignFinite`(provider 也导出同名助手供其他包用),缺失字段**整个键省略**,绝不写成 0 或 NaN(闭合 schema 下 NaN 会让整次调用变成 isError)。
  - 可转债代码按**前两位**分交易所(11x=沪、12x=深),套用股票的首位映射会把所有深市转债发到上交所(踩过);`moneyflow_hsgt` 不接受 `limit`,只能按日期区间取(踩过)。
- **tushare**(provider,`packages/tushare`):金融插件共用的 Tushare Pro 接入,`ctx.provide('tushare', ...)` 暴露 `query` / `tradeDates` / `access` / `configured`。**凭证只配一次**,配额闸也只有一个——Tushare 按账号计量,四个插件各自限流仍会超。
  - **错误必须分类**(用户明确要求):Tushare 一律返回 HTTP 200、把失败写在 body 里,且积分不足 / 频率超限 / 参数错误**都是 code 40203**。三者处置相反,所以 client 把它们分成 `no-token` / `access-denied` / `rate-limited` / `provider-error` / `transport`,**先判权限再判限流**(权限问题重试只会更慢地失败),并原样透传 Tushare 自己的说明(里面有当前积分门槛)。
  - **权限/token 错误的文案要明确要求模型别自己找补**:真实事故是模型只被告知「数据不可用」,就去解压会话日志、伪造 /tmp 数据文件,最后自信地给出错答案。
- **ainfo**(`packages/ainfo`):A 股信息面——新闻、券商研报评级、业绩预告、分红、股东增减持、限售解禁、十大股东。与 astock 分开是因为问题域不同(筛选 40 日最低价用不到这些),而每个注册的工具都会在**每次请求**里占系统提示词预算。全部需要 Tushare token 且**无免费替代**。文本字段原样透传不做改写(改写过的标题模型就无法引用了);新闻正文是唯一例外——源数据带 HTML,要剥成纯文本并截断,且必须标明是摘要。
- **vision**(`packages/vision`,第二个**复制收录**的插件):让纯文本 agent 中途调用多模态模型——`vision` 工具把一个图片文件发给 OpenAI 兼容视觉端点(默认本机 LM Studio,免 key),返回结构化证据;另提供可选的 `vision-bridge` 服务处理用户粘贴的图片。复制自 `gloryxpnv/dsh-tool-vision`(MIT,v0.3.0,commit 35789ca)。**服务商预设 + 三种线格式**(用户明确要求):`provider` 默认 `qwen`,另有 `kimi` / `openai` / `claude` / `gemini` / `custom`,选定即带上端点、协议与起步模型,**唯一必填的是 apiKey**(上游写死本机 LM Studio 地址,等于把图片发给那个端口上恰好在听的东西)。三种协议差异是真实的,写成 `PROTOCOLS` 表:OpenAI 是 `/chat/completions` + `data:` URI + bearer;Anthropic 是 `/messages` + base64 `source` 块 + `x-api-key` + **必须**的 `anthropic-version`,且回复是**块数组**不是字符串;Gemini 是 `/models/<id>:generateContent` + `inline_data` + `x-goog-api-key`,**模型 id 在路径里**(要 encodeURIComponent)。**回环端点不要求 key**,否则会拒绝掉本地 LM Studio 这种能用的配置。路线不完整时**不注册任何工具**,但 section 照常注册并点名缺什么——注册一个必然失败的工具只会浪费提示词预算并诱发调用;日志也说同一件事,否则用户只会看到「这插件没反应」。五处改造都是本仓库既有教训的直接应用:①**失败要点名打的是哪个端点**——上游无论 `baseURL` 配成什么都报 "LM Studio request failed";②**工具必须声明 `timeoutMs`**,且要高于它自己的 HTTP 上限,否则超时策略掐断时不留原因;③**能力事先声明**(`vision:endpoint` section 写明端点、模型、以及失败时如实报告),否则模型会照着文件名编——与 Tushare 那次同一个洞;④证据 schema **刻意不含检测框与置信度**(视觉模型会编),而 `uncertainty` 列表是让它有地方承认读不出来。归一化把类型不对的字段**丢弃而不是强转**(`String(null)` 会变成 'null' 这种伪证据),并补齐缺键——闭合 schema 下少一个键整次调用就 isError。

- **seal**(`packages/seal`,自研):PDF 电子盖章——`seal_stamp`(合同章:指定页面、锚点/毫米坐标、按图片比例保持圆形不变形)与 `seal_straddle`(骑缝章:一枚章按组内页数等分,每页边缘一条)。分层:`lib/geometry.js`(纯算术:毫米↔点、锚点、越界判定、页码选择器、分组、切片窗口)、`lib/pdf.js`(pdf-lib 操作)、`lib/index.js`(工具注册)。要点:
  - **这是本仓库唯一带 runtime 依赖的包**(`pdf-lib`,MIT)。手写 PDF 写入器去省这个依赖,等于用没人验证过的实现处理别人要签字的文件。
  - **骑缝章用裁剪窗口实现,不切像素**:每页画完整的章,`pushOperators` 推入 `q + 路径 + W n` 裁剪、画完 `Q` 还原。**不能靠"画到页面外面让页框挡住"**——页框外的内容仍在文件里,能被提取,那不叫隐藏。
  - **图片盖章 ≠ 电子签名**(必须一直讲):不绑定身份、不能证明此后未被改动。`seal:capability` section 无条件注册,写明《电子签名法》要的是 CA 证书 + 对字节的密码学签名;两个工具的 description 也各自重复一遍。
  - **不生成印章**:印章图片由用户提供(带透明背景的 PNG)。这是有意的边界,不给任意组织画章。
  - **加密 PDF 直接拒绝**:pdf-lib 加 `ignoreEncryption` 能打开,但写回时保护就没了——"盖章成功"等于顺手去掉了密码。本包从不传那个 flag,并在错误信息里说明。
  - **越界不自动纠正、旋转要说明**:章跑出页面只报告是哪几条边(挪回来 = 盖在签署人没选的位置);pdf-lib 绕锚点旋转,所以报告的坐标是旋转前的,越界检查也是按未旋转方框算的,有旋转时结果里明确提示。
  - **默认不覆盖原件**(`overwrite: false`,输出 `<原名>.sealed.pdf`):盖章不可逆,未盖章的原件正是出事时用来比对的。
  - **`seal_sign` 做真正的 PAdES 签名**(`lib/sign.js`,`@signpdf` + `node-forge`):对整个文件的 CMS 签名。三条铁律:①**顺序不可换,先盖章最后签**——签名覆盖的是签那一刻的字节,对已签名文件盖章会让每个阅读器报「文档已被修改」,所以**两个盖章工具都先 `refuseIfSigned`**;②**只能签一次**(pdf-lib 是整文件重写不是增量更新,再签会毁掉第一个签名),多方会签需要能做 incremental update 的工具,如实说明而不是假装支持;③**签名的分量取决于证书**,结果里报出 subject/issuer/是否自签/有效期——自签证书是「某个持有该密钥的人签的」,密码学有效但不证明身份。
  - **上游 `@signpdf/signer-p12` 在非 ASCII 证书名下会产出无效签名(已自带修正版 signer)**:它把 forge 解析出的证书重新编码进 CMS,而 forge 对 `UTF8String` 是「按原始字节返回、再按 UTF-8 编一遍」——解析→重编码不是幂等的。实测 `CN=上海示例科技有限公司` 的证书:issuer 79 字节 → 121 字节,签名指名的签发者匹配不到任何证书,`pdfsig` 报签署人为空 + `Signature is Invalid`。**即每家用中文名签署的公司拿到的都是坏签名**。修法是在 forge 重编码前 `forge.util.decodeUtf8` 那些值(`lib/signer.js` 的 `repairEncoding`),重编码即可还原原始字节;`describeCertificate` 同样要修,否则结果里是乱码。生成证书时非 ASCII 值也**必须**标 `valueTagClass: UTF8`,否则默认 PrintableString 写出的证书 openssl 都解析不了。
  - `pdflibAddPlaceholder` 之后必须 `save({ useObjectStreams: false })`:ByteRange 是靠扫描文件找占位符算出来的,压进对象流就找不到了。
  - **验证方式(不是自证)**:单测用 openssl 现造自签 p12(私钥不进仓库),签完交给 **`pdfsig`(poppler)独立验签**,断言 `Signature is Valid` + `Total document signed`;再翻转一个字节,断言变成 `Digest Mismatch`。`pdfsig` 对无效签名**以非零码退出**,execFileSync 会抛,要从 `error.stdout` 里读结论。openssl / pdfsig 缺席时该用例 skip。
  - 盖章部分的验证:单测用 zlib 手工造带 alpha 的 PNG + 多页 PDF,盖完解压 content stream 断言 `W n` 裁剪存在、`cm` 矩阵逐页左移正好一条;另外真实渲染过一份 4 页合同,把四页右边缘按真实条宽拼起来确认能还原成完整一枚章。

- **im**(`packages/im`,自研):聊天软件驱动 agent——飞书 / 企业微信 / 钉钉 / QQ 发一条消息就跑一次真实回合,回复回到同一个聊天;每个聊天一个持久会话(chat→session 映射存 storage 域,没后端就退化为内存)。分层:`lib/policy.js`(纯判断:白名单、去重、命令解析、回复分段、assistant 文本提取)、`lib/protocols.js`(纯协议:各家验签/载荷/帧编解码)、`lib/channels.js`(传输:HTTP 路由、WebSocket 保活、token 缓存)、`lib/bridge.js`(宿主集成)。几条必须记住的事实:
  - **宿主投递 prompt 的路径**(从已装 dsh 源码读出,不是猜):`ctx.agents.create({ sessionId, agentOptions, meta:{cwd,agentPreset}, setup })` / `ctx.agents.get(id)`;投消息 `agent.followup(createUserMessage({content,source:{kind:'user'}}))`(`createUserMessage` 来自 `@deepseek-ai/dsh-llm`),插队 `agent.steer(...)`,取消 `agent.cancel({kind:'user'},{keepInbox:true})`;收回复订阅 `session/event` 看 `assistant/message` 与 `turn/end`;预设 `agentPresets.resolve(id)` + `.mount(agentCtx,id)`。
  - **配置用 schemastery,存储域用 zod**(踩过:`z.number().optional()` 在 schemastery 上不存在,`domainTable` 要 zod schema)。
  - **只回自己发起的回合**:`awaiting` 表按 sessionId 记账,Web UI 里的回合不会被转播到聊天里。
  - **传输形态决定能不能用**:飞书/企微是回调进来(**要公网地址**),钉钉 Stream 与 QQ 网关是本机连出(**不要公网**)。飞书长连接是 protobuf 帧、要官方 SDK,所以不走。
  - **个人微信不做**(有意):没有官方接口,iLink/wechaty 那类是模拟客户端、违反条款且封号风险由用户承担;微信这一路只走企业微信官方接口,需要的话在 CATALOG 里外链别人的方案并标注非官方。
  - **fail-closed + 一次性配对码**(用户反馈「步骤太麻烦」后加的):空白名单谁都不放行、精确匹配无通配符;拒绝时默认**什么都不回**(回一句"你不在白名单"等于确认这个机器人存在)。平台 id 不透明,用户在被拒之前不知道自己的 id,所以**还没有任何授权账号时启动日志打一个六位码**,在聊天里发这六位数即完成授权并持久化——省掉「捞 id + 第二次重启」。边界:只出现在本机日志、**一次性**、**只在无人授权时提供**、默认 30 分钟过期。**配对码的公布不能挂在 storage inject 回调里**(踩过:没有存储后端时那个回调永不执行,码永远不打印,现象是「插件装了但什么都不回」)。
  - **每条投递都要 ack / 都要去重**:四个平台都会重投它认为失败的回调,重投一次就等于让 agent 再干一遍活;钉钉的 ack 按**帧 id**、去重按**消息 id**(重投带新帧 id,按消息 id 去 ack 永远停不下来)。
  - **socket 的重连与心跳定时器要 `.unref()`**(踩过:纯加载冒烟直接吊住 node 进程不退出)。
  - **未真机联调**:四个渠道都只有单测覆盖(验签、载荷、帧、整条 chat→turn 路径对假宿主),README 里如实写明了这一点。

- **tool-health**(`packages/tool-health`):监听 `tools/result`(实证:**Code Mode 的子调用也会触发这个钩子**——线上 `tool_health.json` 里同时记着 `run_code`、`astock_data`、`astock_market_bars`,所以观测在两种呈现模式下都成立)(**emit 模式,不是 waterfall**,所以无需也无法改写结果)记录每个工具的调用/失败/连续失败次数与最后一次错误,用 storage 域跨会话持久化,再用 `ctx.systemPrompt.context({ text: fn })`(**text 可以是函数、每次组装求值**)把当前坏掉的工具报给模型。三个判断:按**连续失败**而不是失败率(五十次错一次是健康的,连错三次不是);失败会**过期**(默认 24 小时,否则会教模型躲开其实已恢复的工具);健康时返回空串(常驻「一切正常」横幅是在每次请求上花 token 说废话)。storage 用嵌套 inject,没有存储后端时退化为单会话可用而不是拒绝加载。
- **tool-usage**(`packages/tool-usage`):包装 `tools/execute`(**Code Mode 下会重复计时**,踩过:`run_code` 的耗时本就包含它派发的子调用,全部加总会把 100ms 报成 204ms,预算也在一半阈值就误触发。按 `exec.parent` 区分:每个工具仍计自己的全部调用,但**会话总耗时只算顶层调用**;预算提醒点名的是真正干活的那个子调用,而不是 `run_code` 这个传输壳)(**waterfall,必须转发 `next()` 并原样返回其结果**——改了结果的度量插件是 bug 不是度量)计量每个工具的调用次数、耗时分位数与失败数,在 `finally` 里记账所以抛异常的调用也算(否则最烂的工具看起来最便宜)。暴露 `toolUsage` 服务而**不注册工具**:注册工具等于在每次请求的提示词里描述一份没人要的报表。可选预算(`budgetCalls`/`budgetSeconds`),超了才在提示词里提醒,并给出**具体做法**(改批量、收窄窗口、复用已取数据)而不是只说「你很慢」。分位数只保留最近 200 条样本——分位数要反映工具「现在」的表现。
- **astock-chart**(`packages/astock-chart`,仓库第一个 UI 插件):把 `astock_data` 的结果画成 K 线图。三个必须记住的事实:①**卡片只能拿到 `presentationMeta`**——规范值是执行期本地的,既不进卡片也不进回放,所以要画图就得把数据投影到 result meta 上(会随会话日志持久化,因此要打包并限量,现为 120 根);②接入点是客户端 `tool.call.toolview` 插槽,**按工具名 key 注册**,没注册的工具走 ui-tool 的通用卡片——所以画不了时**返回 null** 让通用卡片保留,而不是给个空盒子;②b **Code Mode 下没有卡片**(踩过,实证:code-dispatch 事件只带 `content`/`isError`,无 `meta`)——嵌套 Code 分发会跳过 `presentationMeta` 投影,所以纯 `code` 预设下这张卡片永远拿不到数据。本机因此用自有预设 `code-both`(出厂 `code` 的副本,`mode: both`):批量筛选照走 run_code,单只查询走原生调用才有卡片。**凡是依赖卡片/presentationMeta 的插件,都要在 README 里写明它需要 native 或 both 呈现模式。**③**客户端插件也要声明 `inject`**(踩过):读 `ctx.slots` 却没导出 `inject = ['slots']`,Cordis 会拒绝该属性,**整个 entry apply 失败**,浏览器直接显示「Failed to load plugins」而不是少一张卡片;同时 `package.json` 的 `dsh.client.inject` 要列出提供这些服务的客户端包(`@deepseek-ai/dsh-client-ui-slots` 等),那是模块图的加载顺序。④客户端必须是 **`window.__ModuleLoader__.load({ id, factory })` 工厂格式的产物**,host 扫描 `exports["./client"]` 后服务给浏览器。本包因为除 react(由 host 经 `require` 注入)外零依赖,**手写了这个外壳、不引入前端构建链**,测试直接加载发布产物本身。
- **shortcuts**(`packages/shortcuts`,仓库第一个**复制收录**的插件):Web 客户端键盘快捷键,复制自 `Ricketts-Guo/dsh-shortcuts`(MIT,v1.1.4,commit bf39241),保留原版权并在 README 写明差异。四个事实:①**loader id 必须等于包名**——改包名就必须同步改 `window.__ModuleLoader__.load({ id })`,否则 host 服务出去的 bundle 注册不上,现象是「插件像没装」;②**`ctx.get(name)` 绕过 inject 检查**(查证 cordis `ReflectService.get`:未提供时返回 undefined,不抛错),所以它和 astock-chart 那种属性访问的失败模式不同——`ctx.slots` 会「Failed to load plugins」,`ctx.get('slots')` 只会静默拿到 undefined;③正因如此,**只被单个功能用到的服务(theme/workspaces/locale/modelDirectories/conversation)刻意不进 `inject`**——inject 决定 apply **何时**运行且要等齐所有名字,声明它们等于用「切换语言不生效」换「所有快捷键都不生效」;④上游测试用 DOM 沙箱驱动按键、并从本机 dsh 的 node_modules 解析 React,换台机器就跑不了,改造时把键位解析的纯函数从 bundle 导出直接断言。

- **aportfolio**(`packages/aportfolio`,仓库唯一有状态的插件):持仓与自选,用 storage 域跨会话持久化,自带一个极小的东财取价器(不依赖 astock,单独装也能用)。四条判断:**状态存存储不存对话**(要从聊天历史重读的仓位迟早读错);**用户没说的不存**,`set` 是整条替换而非增量(避免"又买了 100 股"被误解成翻倍);**取不到价的持仓是「未知」不是「不值钱」**——不写 0,总额里排除并声明不完整;**到上限拒绝而不是淘汰**(被静默丢掉的持仓用户无从察觉)。
- **tool-retry**(`packages/tool-retry`):对可恢复的工具失败做重试。两个平台事实是它成立的前提,都是查证过的:①`timeoutMs` 由官方插件 `dsh-tool-call-timeout-policy` 强制(所以我们**不做超时**,只做重试);②**cordis 的 waterfall 会消费监听器列表**(`(cbs.shift() ?? inner)(...)`),所以 `next()` 可以重复调用并真的重新分发,但**第二次会跳过已被取走的下游包装器**——包括那个超时策略,因此每次重试必须由本插件自己加截止时间(与调用方信号 `AbortSignal.any` 融合,不是替换)。安全底线:工具契约里没有「幂等」,所以**默认什么都不重试**,由运维在 `retryTools` 里点名(只支持完整名或 `前缀*`,刻意不用正则);重试用尽返回**真实失败**并附「已重试 N 次」,绝不改写成成功。
- **gateway-compat**:`llm/stream` waterfall 包装的参考实现——把网关缺失 `[DONE]` 导致的 `STREAM_CLOSED` 终止错误改写为正常 `stop`,但仅在已收到正文且无 tool call 进行中时,真正的中途断流仍然失败并保留重试资格。

## dsh 插件开发规范(违反会启动崩溃或静默失效)

### 插件形态与生命周期

1. **导出形式**:函数插件命名导出 `name` / `inject` / `apply(ctx, config)`,**不要**同时有 default 导出(Loader 会丢弃命名空间,`inject` 静默失效)。依赖的服务必须列进 `inject`(如 `['tools', 'systemPrompt']`),框架保证服务就绪后才调用 `apply`。
2. **注册即自动清理**:一切通过 `ctx` 注册(`ctx.tools.register`、`ctx.on`、`ctx.systemPrompt.section`),插件卸载(含 HMR 热替换)自动撤销;需手动清理的资源用 `ctx.effect(() => { ...; return 清理函数 })`。
3. 不用的 import 立刻删——符号链接加载下,多余依赖就是启动崩溃源。

### 配置

4. **不写死部署可变参数**(超时、端点、周期列表等)。检验标准:能否只改 cordis.patch.yml 不改代码就换值。需要校验时导出 Schemastery `Config`(默认值写在 schema 里,不要导出普通对象),让无效配置在加载时响亮失败。
5. **通用插件禁止出现客户名/客户逻辑**;客户差异放客户自己 bundle 的配置层(私有仓库),或做成 Provider 缝。

### 工具(defineTool)

6. **schema 必须显式**:每个 `type: 'object'` 节点**必须显式写 `additionalProperties: true|false`**,否则 `defineTool` 定义期即抛错、整个插件树启动失败(astock 踩过,错误:`additionalProperties must be explicitly true or false`)。
7. **execute 只返回 `output.schema` 声明的规范 JSON 值**,把它当程序化 API 设计(直接给 id 和字段;Code Mode 会以 `await tools.<name>(args)` 拿到该值);面向模型的自然语言放 `output.render(args, value)`。基础设施故障抛异常(→ `isError`);不理想但成功的领域结果写进规范值,由 render 解释。
8. 遵守 `exec.signal` 取消;`args` 视为只读;注册后不改 schema、不换回调。
9. **UI 卡片展示器(`presentCall` / `presentResult`)必须是纯函数**——会话回放时也会执行,不做 I/O、不读时钟/随机数;结果期事实用 `output.presentationMeta` 投影持久化。UI 格式(围栏代码块、diff 文本)不进入规范值或 render 输出。

### 事件(waterfall)

10. **Waterfall 监听器必须调 `next()`** 才会传递(`llm/stream`、`tools/pre-execute` 等);不调就短路整条链。包装流时逐块转发,只改写自己关心的块(参照 `gateway-compat`)。
11. 扩展点选型:允许/拒绝/询问用 `tools/pre-execute`;不可撤销的最终拒绝用 `ctx.tools.guard()`;包裹分发(超时/重试/指标)用 `tools/execute`;变换结果用 `tools/post-execute`;只观测不改用 `tools/result`;工具可见性过滤用 `ctx.tools.restrict()`。

### bundle 与配置层

12. patch 里插件行按**包名**引用(`name: dsh-plugin-<name>`),不是相对路径。层顺序(后应用按行胜出):profile 的 bundles 按安装顺序 → profile 自己的 `cordis.patch.yml` → home 级 `$DSH_HOME/cordis.patch.yml` → `--patch` overlay。patch 覆盖是**整行 config 替换、不深度合并**——覆盖别人的行要重述全部键;反过来给用户大概率保留的默认值,其余交给 schema。
13. 分发:git 直装拉源码不构建,需要自包含 `prepare` 脚本 + 用户在 `pnpm-workspace.yaml` 里 `allowBuilds` 授权;发私有 npm 或 `pnpm pack` tarball 无此坎。本仓库插件免构建纯 ESM,git 直装可用,发布前确认 `files` 覆盖 `lib` 和 `cordis.patch.yml`。

## 单元测试规范

用 Node 内置 test runner(`node:test` + `node:assert/strict`),零依赖、免构建,与插件"纯 ESM 直接加载"一致(上游 dsh 用 vitest,不适用本仓库)。

- **位置**:每个包 `packages/<name>/test/*.test.js`,测试与被测包同住;`files` 不含 `test`,不随包发布。
- **命令**:根 `npm test` 跑全部;单包 `npm test -w <package-name>`(或 cd 进包目录跑 `npm test`);单文件 `node --test packages/<name>/test/<file>.test.js`。
- **测真实入口**:`import * as plugin from '../lib/index.js'`(发布产物路径)。每个插件必须有一个入口测试(参照两个包的 `test/plugin.test.js`):
  - 断言 `!('default' in plugin)` 且命名导出 `name` / `apply`(有依赖的还有 `inject`)——防"default 导出丢 inject"回归;
  - 用 fake ctx(只需捕获 `tools.register` / `systemPrompt.section` / `on`)调 `apply`,断言注册的工具名与 section 齐全。真实 `defineTool` 在 `apply` 时执行,schema 违规(如缺 `additionalProperties`)在这一步就红,无需启动 dsh。
- **只 mock 昂贵/非确定性边界**(网络、时钟);指标计算、流改写、`render` / `presentCall` / `presentResult` 都是纯函数,直接喂数据断言输出。
- **waterfall 插件**(如 gateway-compat):捕获监听器后用手造 async generator 喂 chunk 流,两个方向都要断言——改写命中,且真实错误路径仍原样失败。
- **单测绿 ≠ 交付**:单测不经过 Loader 与真实组合,改完仍要走下面的验证清单。
- **仓库级合规检查**:`test/spec-compliance.test.js` 自动遍历 `packages/*/*`,校验本文件里那些**单包单测看不见**的规则——四处名字一致、无 default 导出、无未使用 import、开源元数据齐全(license/files/keywords/category/repository.directory/README)、每包都有入口测试、tools 插件的每个工具都有 output.schema/render/timeoutMs。新增插件会被自动纳入,不需要登记。

## 验证清单(改完插件后)

> **不要把插件装进用户的 `web` profile 做验证**(用户明确要求):本机 profile 只保留用户真正在用的那几个。要端到端验证就开一次性 profile(`--profile tmp-<名字>`),验证完 `plugin remove` 并删掉 profile;`pnpm` 移除后会**留下悬挂的符号链接**,一并删掉。`--dump-config` 和纯加载冒烟不需要装进任何 profile。


1. 单元测试:`npm test -w <package-name>`(改公共约定跑根 `npm test`,它同时跑仓库级合规检查)——抓逻辑回归与 schema 违规;
2. 纯加载冒烟(上面的 `node -e import` 一行)——抓语法/依赖错误;
3. `--dump-config` 确认插件行在组合树里;
4. 菜单重启服务,确认 `dsh-desktop.log` 出现 `serving on`(启动崩溃会记完整堆栈);
5. 行为验证:UI 里让模型调用工具,或 headless 跑一条任务;调不通时解压最新会话日志看 `tool/result` 与 `finish` 事件。
