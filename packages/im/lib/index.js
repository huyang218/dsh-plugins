/**
 * im — command the agent from a chat app on your phone.
 *
 * A message in Lark, WeCom, DingTalk or QQ drives a real agent turn in a real
 * session, and the reply comes back to the same chat. Each chat keeps its own
 * session across messages and across restarts.
 *
 * Three deliberate limits:
 *
 *   **Nobody is allowed by default.** `allowFrom` is empty, and an empty
 *   allowlist admits nobody. This is a remote control for a machine with shell
 *   and file access; an open default is not a convenience.
 *
 *   **Personal WeChat is not supported.** It has no official bot API, and the
 *   gateways that reach it (iLink, wechaty and friends) work by impersonating a
 *   client, against WeChat's terms and at the account's risk. WeCom is the
 *   official route and its messages arrive on the same phone.
 *
 *   **A turn this bridge did not start is left alone.** Typing in the web UI
 *   does not get echoed to your chat.
 *
 * @module dsh-plugin-im
 */

import Schema from '@deepseek-ai/schemastery'
import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { createBridge, createRoutes } from './bridge.js'
import { dingtalkChannel, larkChannel, qqChannel, wecomChannel } from './channels.js'
import { createDedupe } from './policy.js'

/** Cordis plugin name used by loader diagnostics. */
const name = 'im'

/**
 * Where each chat's session id is kept, so a phone conversation survives a
 * restart instead of starting over on the next message.
 */
const IM_DOMAIN = defineDomain({
  name: 'im_routes',
  version: 1,
  tables: {
    routes: domainTable(z.object({
      sessionId: z.string(),
      at: z.number().optional(),
    })),
  },
})

/**
 * Services required before `apply` runs.
 *
 * `webServer` is here because the Lark and WeCom callbacks are HTTP routes;
 * without it those two cannot exist, and a bridge that loads without its
 * transports would look installed while doing nothing.
 */
const inject = ['agents', 'sessions', 'webServer']

const Config = Schema.object({
  allowFrom: Schema.array(Schema.string()).default([]).description(
    '允许驱动 agent 的发送者 id(飞书 open_id、企微 UserID、钉钉 staffId、QQ openid)。'
    + '**默认空 = 谁都不允许**:这是一个能读写文件、执行命令的机器的遥控器,开放默认值不是便利。'
    + '不确定自己的 id 就先发一条消息,日志里会打出被拒绝的那个 id,复制进来即可。',
  ),
  cwd: Schema.string().default('').description(
    '从聊天里新建会话时使用的工作区绝对路径。留空则用 dsh 进程的工作目录。',
  ),
  agentPreset: Schema.string().default('').description(
    '新建会话用哪个 agent 预设(留空 = 部署默认)。手机上通常只发文字,`standard` 就够;'
    + '要跑批量筛选那类工具再选 Code Mode 预设。',
  ),
  replyChars: Schema.number().default(1800).description(
    '单条回复的最大字符数,超出按段切分并标 `[1/3]`。聊天平台会拒收或截断过长消息,'
    + '而被截断的答案比被切分的更糟——读者看不出后面还有。',
  ),
  refusalNotice: Schema.string().default('').description(
    '拒绝未授权发送者时回给对方的话。**留空(默认)= 什么都不回**:对陌生人沉默,'
    + '比告诉他「你不在白名单里」更少暴露这个机器人在做什么。',
  ),
  lark: Schema.object({
    enabled: Schema.boolean().default(false),
    appId: Schema.string().default(''),
    appSecret: Schema.string().default(''),
    verificationToken: Schema.string().default('').description('事件订阅的 Verification Token,用于验签。'),
    path: Schema.string().default('/im/lark').description('回调路由前缀。'),
  }).description(
    '飞书 / Lark(事件订阅,**需要公网可达地址**——长连接模式是 protobuf 帧,要官方 SDK,本插件不用依赖所以不走那条)。',
  ),
  wecom: Schema.object({
    enabled: Schema.boolean().default(false),
    corpId: Schema.string().default(''),
    corpSecret: Schema.string().default(''),
    agentId: Schema.number().default(0),
    token: Schema.string().default('').description('接收消息的 Token。'),
    encodingAesKey: Schema.string().default('').description('接收消息的 EncodingAESKey(43 位)。'),
    path: Schema.string().default('/im/wecom').description('回调路由前缀。'),
  }).description(
    '企业微信自建应用(**需要公网可达地址**)。这是微信这一路唯一的官方接口,消息在手机企业微信里收发。',
  ),
  dingtalk: Schema.object({
    enabled: Schema.boolean().default(false),
    clientId: Schema.string().default('').description('应用的 Client ID(AppKey)。'),
    clientSecret: Schema.string().default('').description('应用的 Client Secret(AppSecret)。'),
  }).description('钉钉 Stream 模式(**不需要公网地址**,由本机主动连出)。'),
  qq: Schema.object({
    enabled: Schema.boolean().default(false),
    appId: Schema.string().default(''),
    appSecret: Schema.string().default('').description('机器人的 AppSecret。'),
    intents: Schema.number().default((1 << 25) | (1 << 30)).description(
      '网关 intents 位图。默认订阅群 @ 消息与单聊消息;要别的事件按官方文档加位。',
    ),
    sandbox: Schema.boolean().default(false).description('走沙箱环境(仅在沙箱里配置了频道时有用)。'),
  }).description('QQ 官方机器人(WebSocket 网关,**不需要公网地址**)。'),
  dedupeEntries: Schema.number().default(500).description(
    '记住多少条已处理的消息 id 用于去重。这些平台都会重投它认为失败的回调,'
    + '而重投一次就等于让 agent 再干一遍活。',
  ),
})

/**
 * Wire the enabled channels to the session bridge.
 * @param {Object} ctx - the plugin context.
 * @param {Object} config - the validated configuration.
 */
function apply(ctx, config) {
  const log = {
    info: message => ctx.logger?.info?.(message),
    warn: message => ctx.logger?.warn?.(message),
  }

  const enabled = ['lark', 'wecom', 'dingtalk', 'qq'].filter(key => config[key].enabled)
  if (enabled.length === 0) {
    log.warn('[im] no channel is enabled; nothing to bridge')
    return
  }
  if (config.allowFrom.length === 0) {
    // Loud, because this is the state where every message is refused and the
    // reason is a config field nobody remembers being empty.
    log.warn('[im] allowFrom is empty: every message will be refused. Add your sender id to use the bridge.')
  }

  const dedupe = createDedupe(config.dedupeEntries)

  /** Set by `start` below, before any channel can call it. */
  let handleMessage

  // The mapping is nice to keep, not required to work: without a storage
  // backend the bridge forgets which session a chat had and starts a new one
  // on the next message, which is recoverable. Refusing to load would not be.
  const started = start(createRoutes(undefined))
  ctx.inject(['storageDomain'], storageCtx => {
    void storageCtx.storageDomain.open(IM_DOMAIN).then(domain => {
      storageCtx.effect(() => () => { void domain.close().catch(() => {}) }, 'im: routes domain')
      started.upgrade(createRoutes(domain.table('routes')))
      log.info('[im] chat-to-session mapping is persisted')
    }).catch(error => {
      log.warn(`[im] chat-to-session mapping stays in memory: ${String(error)}`)
    })
  })

  /**
   * Build the bridge over a route store, allowing the store to be swapped once
   * storage opens — the channels are already connected by then, and tearing
   * them down to re-create them would drop a message mid-flight.
   * @param {Object} initial - the route store to start with.
   * @returns {Object} `{ upgrade }`
   */
  function start(initial) {
    let store = initial
    const proxy = {
      get: key => store.get(key),
      set: (key, sessionId) => store.set(key, sessionId),
    }
    const bridge = createBridge(ctx, {
      config: { ...config, cwd: config.cwd || process.cwd() },
      routes: proxy,
      log,
    })
    ctx.effect(() => bridge.dispose)
    handleMessage = bridge.handle
    return { upgrade: next => { store = next } }
  }

  /**
   * One gate in front of every channel: drop a redelivery, then hand over.
   * @param {Object} inbound - the parsed message.
   * @param {Object} channel - the channel it arrived on.
   * @returns {Promise<void>} resolves when the message has been dealt with
   */
  const onMessage = async (inbound, channel) => {
    if (dedupe.seen(`${channel.name}:${inbound.deliveryId}`)) {
      log.info(`[im] ${channel.name}: ignoring a redelivery of ${inbound.deliveryId}`)
      return
    }
    try {
      await handleMessage(inbound, channel)
    } catch (error) {
      log.warn(`[im] ${channel.name}: handling a message failed: ${String(error)}`)
    }
  }

  const factories = {
    lark: larkChannel,
    wecom: wecomChannel,
    dingtalk: dingtalkChannel,
    qq: qqChannel,
  }

  for (const key of enabled) {
    const channel = factories[key]({ ctx, config: config[key], log, onMessage })
    ctx.effect(() => channel.dispose)
    log.info(channel.needsPublicUrl
      ? `[im] ${key}: serving its callback at ${channel.path} — this must be reachable from the internet`
      : `[im] ${key}: connecting out; no public address needed`)
  }
}

export { name, inject, Config, apply }
