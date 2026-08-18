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
import { createAccess, createPairing } from './access.js'
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
    // Paired senders live here so authorising a phone does not mean editing a
    // config file and restarting a second time.
    paired: domainTable(z.object({ at: z.number().optional() })),
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
  pairing: Schema.boolean().default(true).description(
    '允许**一次性配对码**授权。开启时,如果还没有任何授权账号,启动日志会打出一个六位码;'
    + '在聊天里把这六位数发给机器人就完成授权,结果持久化——不用去日志里找自己的 id,也不用'
    + '为了填 `allowFrom` 再重启一次。码是一次性的,用掉即失效,且只在「还没有任何授权账号」时提供。'
    + '关掉它就只认 `allowFrom` 里写死的 id。',
  ),
  pairingMinutes: Schema.number().default(30).description(
    '配对码的有效期(分钟)。过期后重启服务会给一个新的。',
  ),
  language: Schema.union(['zh', 'en']).default('zh').description(
    '机器人自己说的话用哪种语言(命令说明、`已取消`、`回合结束没有回复` 这类)。'
    + '这些是给人看的,不是给模型看的——模型的回复本身用什么语言由你怎么问决定。',
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

/** What each channel cannot work without. */
const REQUIRED = {
  lark: ['appId', 'appSecret'],
  wecom: ['corpId', 'corpSecret', 'token', 'encodingAesKey'],
  dingtalk: ['clientId', 'clientSecret'],
  qq: ['appId', 'appSecret'],
}

/**
 * The credentials a channel is enabled without.
 *
 * Checked before connecting, because the alternative is what it did before:
 * dial out with an empty key, fail, and retry on a backoff — filling the log
 * with transport errors when the answer is a blank config field.
 *
 * @param {string} key - the channel name.
 * @param {Object} settings - that channel's config.
 * @returns {string[]} missing field names.
 */
export function missingCredentials(key, settings) {
  return REQUIRED[key].filter(field => String(settings[field] ?? '').trim().length === 0)
}

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

  const enabled = []
  for (const key of ['lark', 'wecom', 'dingtalk', 'qq']) {
    if (!config[key].enabled) continue
    const missing = missingCredentials(key, config[key])
    if (missing.length > 0) {
      log.warn(`[im] ${key} is enabled but missing ${missing.join(', ')}; not connecting`)
      continue
    }
    enabled.push(key)
  }
  if (enabled.length === 0) {
    log.warn('[im] no channel is enabled; nothing to bridge')
    return
  }

  const dedupe = createDedupe(config.dedupeEntries)

  /** Set by `start` below, before any channel can call it. */
  let handleMessage

  const pairing = config.pairing
    ? createPairing({ ttlMs: Math.max(1, config.pairingMinutes) * 60 * 1000 })
    : undefined
  let access = createAccess({ configured: config.allowFrom, pairing, log })

  // The mapping is nice to keep, not required to work: without a storage
  // backend the bridge forgets which session a chat had and starts a new one
  // on the next message, which is recoverable. Refusing to load would not be.
  const started = start(createRoutes(undefined))
  ctx.inject(['storageDomain'], storageCtx => {
    void storageCtx.storageDomain.open(IM_DOMAIN).then(async domain => {
      storageCtx.effect(() => () => { void domain.close().catch(() => {}) }, 'im: im_routes domain')
      started.upgrade(createRoutes(domain.table('routes')))
      // Rebuild access over the persisted table, then restore who was paired
      // before the restart — otherwise every restart would ask to pair again.
      access = createAccess({ configured: config.allowFrom, table: domain.table('paired'), pairing, log })
      const restored = await access.restore()
      started.useAccess(access)
      // Only re-announce when storage changed the picture: it did if someone
      // was already paired, which means the code printed a moment ago is void.
      if (restored > 0) announceAccess(restored)
    }).catch(error => {
      log.warn(`[im] state stays in memory (${String(error)}); pairing will not survive a restart`)
    })
  })

  // Announced here, not inside the storage callback: a deployment with no
  // storage backend never runs that callback, and the pairing code would never
  // be printed — leaving a bridge that refuses every message for no stated
  // reason.
  announceAccess(0)

  /**
   * Say, once, how someone becomes authorised — the question every operator
   * has at this point, and the one the log used to answer only after refusing
   * them.
   * @param {number} restored - paired senders recovered from storage.
   */
  function announceAccess(restored) {
    const code = access.pairingCode()
    if (code !== undefined) {
      log.warn(`[im] nobody is authorised yet. Send this pairing code to the bot in a chat to authorise yourself: ${code}`)
      log.warn(`[im] 还没有任何授权账号。在聊天里把这个配对码发给机器人即可授权:${code}(${config.pairingMinutes} 分钟内有效)`)
      return
    }
    if (access.anyone()) {
      log.info(`[im] authorised senders: ${config.allowFrom.length} configured, ${restored} paired`)
      return
    }
    log.warn('[im] nobody is authorised and pairing is off: every message will be refused. Fill allowFrom.')
  }

  /**
   * Build the bridge over a route store, allowing the store to be swapped once
   * storage opens — the channels are already connected by then, and tearing
   * them down to re-create them would drop a message mid-flight.
   * @param {Object} initial - the route store to start with.
   * @returns {Object} `{ upgrade }`
   */
  function start(initial) {
    let store = initial
    const bridge = createBridge(ctx, {
      config: { ...config, cwd: config.cwd || process.cwd() },
      routes: {
        get: key => store.get(key),
        set: (key, sessionId) => store.set(key, sessionId),
      },
      // Indirected for the same reason as the routes: storage opens after the
      // channels are already connected, and rebuilding them would drop a
      // message in flight.
      access: {
        allows: senderId => access.allows(senderId),
        claim: (senderId, text) => access.claim(senderId, text),
      },
      log,
    })
    ctx.effect(() => bridge.dispose)
    handleMessage = bridge.handle
    return {
      upgrade: next => { store = next },
      useAccess: next => { access = next },
    }
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
