/**
 * Transports. Four platforms, two shapes:
 *
 *   Lark and WeCom deliver over an HTTP callback, so dsh must be reachable
 *   from the internet — a tunnel or a reverse proxy. Each registers one route.
 *
 *   DingTalk and QQ have the client open a socket, so they work from a laptop
 *   behind NAT with nothing exposed. Each opens a WebSocket and keeps it alive.
 *
 * Everything protocol-shaped lives in `protocols.js`; this file is sockets,
 * routes, tokens and retries, and is deliberately the part with the least
 * decision-making in it.
 *
 * @module dsh-plugin-im/channels
 */

import {
  DINGTALK_GATEWAY, QQ_OP, dingtalkAck, dingtalkInbound, dingtalkOpenBody,
  larkInbound, larkSignature, qqIdentify, qqInbound, signatureEquals,
  wecomDecrypt, wecomInbound, wecomSignature,
} from './protocols.js'

/**
 * A token that is fetched on demand and reused until it is nearly expired.
 *
 * Every one of these platforms hands out a short-lived token and rate-limits
 * the endpoint that issues it, so fetching one per message is a way to get
 * blocked. Refreshed a minute early because a token that expires in flight
 * fails the send, not the refresh.
 *
 * @param {Function} fetchToken - returns `{ token, expiresInSeconds }`.
 * @returns {Function} an async function returning a live token
 */
export function cachedToken(fetchToken) {
  let token
  let expiresAt = 0
  let inFlight
  return async () => {
    if (token !== undefined && Date.now() < expiresAt) return token
    // Single-flight: a burst of chat messages would otherwise each start their
    // own refresh, and some of these endpoints count that as abuse.
    inFlight ??= (async () => {
      const fresh = await fetchToken()
      token = fresh.token
      expiresAt = Date.now() + Math.max(0, (fresh.expiresInSeconds ?? 0) - 60) * 1000
      return token
    })().finally(() => { inFlight = undefined })
    return inFlight
  }
}

/**
 * Read a JSON request body with a cap.
 * @param {Object} req - the incoming request.
 * @param {number} limit - largest body accepted, in bytes.
 * @returns {Promise<string>} the raw body text
 */
async function readBody(req, limit = 1024 * 512) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) throw new Error('body too large')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

/** Answer a callback. These platforms only care that it is a 200. */
function respond(res, status, body = '', type = 'text/plain') {
  res.writeHead(status, { 'content-type': type })
  res.end(body)
}

// ── Lark / 飞书 ─────────────────────────────────────────────────────────────

/**
 * Lark event subscription over an HTTP callback.
 * @param {Object} deps - `{ ctx, config, log, onMessage }`.
 * @returns {Object} the channel
 */
export function larkChannel({ ctx, config, log, onMessage }) {
  const { appId, appSecret, verificationToken, path } = config
  const accessToken = cachedToken(async () => {
    const response = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
    })
    const json = await response.json()
    if (json.code !== 0) throw new Error(`lark token: ${json.code} ${json.msg}`)
    return { token: json.tenant_access_token, expiresInSeconds: json.expire }
  })

  const channel = {
    name: 'lark',
    async send(inbound, text) {
      const response = await fetch('https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${await accessToken()}` },
        body: JSON.stringify({
          receive_id: inbound.chatId,
          msg_type: 'text',
          content: JSON.stringify({ text }),
        }),
      })
      const json = await response.json()
      if (json.code !== 0) throw new Error(`lark send: ${json.code} ${json.msg}`)
    },
  }

  const dispose = ctx.webServer.register({
    kind: 'prefix',
    path,
    handler: (req, res) => {
      void (async () => {
        let body
        try {
          body = await readBody(req)
        } catch (error) {
          respond(res, 413, String(error))
          return
        }

        // Signature first, before the body is trusted for anything — including
        // the handshake, which is a request like any other.
        const header = name => String(req.headers[name] ?? '')
        if (verificationToken.length > 0) {
          const presented = header('x-lark-signature')
          const expected = larkSignature({
            timestamp: header('x-lark-request-timestamp'),
            nonce: header('x-lark-request-nonce'),
            token: verificationToken,
            body,
          })
          if (presented.length > 0 && !signatureEquals(expected, presented)) {
            log.warn('[im] lark: signature mismatch; delivery refused')
            respond(res, 401, 'bad signature')
            return
          }
        }

        let payload
        try {
          payload = JSON.parse(body)
        } catch {
          respond(res, 400, 'bad json')
          return
        }
        const inbound = larkInbound(payload)
        if (inbound.kind === 'challenge') {
          respond(res, 200, JSON.stringify({ challenge: inbound.challenge }), 'application/json')
          return
        }
        // Answer before the turn runs: Lark retries a callback that does not
        // return quickly, and a retried delivery is a second turn.
        respond(res, 200, 'ok')
        if (inbound.kind !== 'message' || inbound.text.length === 0) return
        await onMessage(inbound, channel)
      })()
    },
  })

  return { ...channel, dispose, needsPublicUrl: true, path }
}

// ── WeCom / 企业微信 ────────────────────────────────────────────────────────

/**
 * WeCom app callback over HTTP: XML, AES-encrypted, sha1-signed.
 * @param {Object} deps - `{ ctx, config, log, onMessage }`.
 * @returns {Object} the channel
 */
export function wecomChannel({ ctx, config, log, onMessage }) {
  const { corpId, corpSecret, agentId, token, encodingAesKey, path } = config
  const accessToken = cachedToken(async () => {
    const url = new URL('https://qyapi.weixin.qq.com/cgi-bin/gettoken')
    url.searchParams.set('corpid', corpId)
    url.searchParams.set('corpsecret', corpSecret)
    const json = await (await fetch(url)).json()
    if (json.errcode !== 0) throw new Error(`wecom token: ${json.errcode} ${json.errmsg}`)
    return { token: json.access_token, expiresInSeconds: json.expires_in }
  })

  const channel = {
    name: 'wecom',
    async send(inbound, text) {
      const url = new URL('https://qyapi.weixin.qq.com/cgi-bin/message/send')
      url.searchParams.set('access_token', await accessToken())
      const json = await (await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ touser: inbound.chatId, msgtype: 'text', agentid: agentId, text: { content: text } }),
      })).json()
      if (json.errcode !== 0) throw new Error(`wecom send: ${json.errcode} ${json.errmsg}`)
    },
  }

  const dispose = ctx.webServer.register({
    kind: 'prefix',
    path,
    handler: (req, res) => {
      void (async () => {
        const url = new URL(req.url ?? '/', 'http://localhost')
        const query = key => url.searchParams.get(key) ?? ''

        // The GET on this route is the one-off URL check, which must echo the
        // decrypted echostr or the callback can never be saved.
        const encryptFromQuery = query('echostr')
        const body = req.method === 'GET' ? '' : await readBody(req).catch(() => '')
        const encrypt = encryptFromQuery.length > 0 ? encryptFromQuery : xmlEncrypt(body)
        if (encrypt.length === 0) {
          respond(res, 400, 'no payload')
          return
        }

        const expected = wecomSignature({ token, timestamp: query('timestamp'), nonce: query('nonce'), encrypt })
        if (!signatureEquals(expected, query('msg_signature'))) {
          log.warn('[im] wecom: msg_signature mismatch; delivery refused')
          respond(res, 401, 'bad signature')
          return
        }

        let message
        try {
          message = wecomDecrypt({ encrypt, encodingAesKey, receiveId: corpId })
        } catch (error) {
          log.warn(`[im] wecom: ${String(error)}`)
          respond(res, 400, 'bad payload')
          return
        }
        if (encryptFromQuery.length > 0) {
          respond(res, 200, message)
          return
        }

        respond(res, 200, '')
        const inbound = wecomInbound(message)
        if (inbound.kind !== 'message' || inbound.text.length === 0) return
        await onMessage(inbound, channel)
      })().catch(error => {
        log.warn(`[im] wecom: ${String(error)}`)
        respond(res, 500, 'error')
      })
    },
  })

  return { ...channel, dispose, needsPublicUrl: true, path }
}

/** The `Encrypt` element of a WeCom callback body. */
function xmlEncrypt(body) {
  const match = /<Encrypt>(?:<!\[CDATA\[([\s\S]*?)\]\]>|([\s\S]*?))<\/Encrypt>/.exec(body)
  return (match?.[1] ?? match?.[2] ?? '').trim()
}

// ── DingTalk / 钉钉 Stream ──────────────────────────────────────────────────

/**
 * DingTalk Stream mode: the client opens the socket, so no public URL.
 * @param {Object} deps - `{ config, log, onMessage }`.
 * @returns {Object} the channel
 */
export function dingtalkChannel({ config, log, onMessage }) {
  const channel = {
    name: 'dingtalk',
    async send(inbound, text) {
      // The per-message webhook needs no token and expires with the message,
      // which is why a reply has to be sent while the turn is still recent.
      if (!inbound.replyWebhook) throw new Error('dingtalk: this message carried no sessionWebhook')
      const json = await (await fetch(inbound.replyWebhook, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ msgtype: 'text', text: { content: text } }),
      })).json().catch(() => ({}))
      if (json.errcode !== undefined && json.errcode !== 0) {
        throw new Error(`dingtalk send: ${json.errcode} ${json.errmsg}`)
      }
    },
  }

  const socket = keepSocket({
    log,
    name: 'dingtalk',
    async endpoint() {
      const response = await fetch(DINGTALK_GATEWAY, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(dingtalkOpenBody(config)),
      })
      if (!response.ok) throw new Error(`dingtalk gateway: HTTP ${response.status}`)
      const json = await response.json()
      if (!json.endpoint || !json.ticket) throw new Error(`dingtalk gateway: ${JSON.stringify(json).slice(0, 200)}`)
      return `${json.endpoint}?ticket=${encodeURIComponent(json.ticket)}`
    },
    onFrame: async (frame, ws) => {
      const inbound = dingtalkInbound(frame)
      if (inbound.kind === 'system') return
      // Acknowledge every delivery, including one this bridge ignores:
      // an unacknowledged frame is redelivered until it is.
      if (inbound.messageId) ws.send(JSON.stringify(dingtalkAck(inbound.messageId)))
      if (inbound.kind !== 'message' || inbound.text.length === 0) return
      await onMessage(inbound, channel)
    },
  })

  return { ...channel, dispose: socket.dispose, needsPublicUrl: false }
}

// ── QQ official bot gateway ─────────────────────────────────────────────────

/**
 * QQ official bot over its opcode gateway.
 * @param {Object} deps - `{ config, log, onMessage }`.
 * @returns {Object} the channel
 */
export function qqChannel({ config, log, onMessage }) {
  const { appId, appSecret, intents, sandbox } = config
  const api = sandbox ? 'https://sandbox.api.sgroup.qq.com' : 'https://api.sgroup.qq.com'
  const accessToken = cachedToken(async () => {
    const json = await (await fetch('https://bots.qq.com/app/getAppAccessToken', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ appId, clientSecret: appSecret }),
    })).json()
    if (!json.access_token) throw new Error(`qq token: ${JSON.stringify(json).slice(0, 200)}`)
    return { token: json.access_token, expiresInSeconds: Number(json.expires_in) || 7200 }
  })

  const channel = {
    name: 'qq',
    async send(inbound, text) {
      const target = inbound.groupOpenId
        ? `${api}/v2/groups/${inbound.groupOpenId}/messages`
        : `${api}/v2/users/${inbound.senderId}/messages`
      const response = await fetch(target, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `QQBot ${await accessToken()}` },
        // msg_id makes this a passive reply, which is what a bot is allowed to
        // send without a push quota.
        body: JSON.stringify({ content: text, msg_type: 0, msg_id: inbound.messageId }),
      })
      if (!response.ok) throw new Error(`qq send: HTTP ${response.status} ${(await response.text()).slice(0, 200)}`)
    },
  }

  let heartbeat
  let sequence = null
  const socket = keepSocket({
    log,
    name: 'qq',
    async endpoint() {
      const json = await (await fetch(`${api}/gateway`, {
        headers: { authorization: `QQBot ${await accessToken()}` },
      })).json()
      if (!json.url) throw new Error(`qq gateway: ${JSON.stringify(json).slice(0, 200)}`)
      return json.url
    },
    onClose: () => { clearInterval(heartbeat) },
    onFrame: async (frame, ws) => {
      const inbound = qqInbound(frame)
      if (inbound.sequence !== undefined && inbound.sequence !== null) sequence = inbound.sequence
      if (inbound.kind === 'hello') {
        ws.send(JSON.stringify(qqIdentify({ appId, token: await accessToken(), intents })))
        clearInterval(heartbeat)
        heartbeat = setInterval(() => {
          try {
            ws.send(JSON.stringify({ op: QQ_OP.HEARTBEAT, d: sequence }))
          } catch {
            // The keeper reconnects; a failed heartbeat is how it finds out.
          }
        }, inbound.heartbeatMs).unref?.()
        return
      }
      if (inbound.kind === 'reconnect') {
        log.warn('[im] qq: gateway asked for a reconnect')
        ws.close()
        return
      }
      if (inbound.kind !== 'message' || inbound.text.length === 0) return
      await onMessage(inbound, channel)
    },
  })

  return {
    ...channel,
    dispose: () => { clearInterval(heartbeat); socket.dispose() },
    needsPublicUrl: false,
  }
}

/**
 * A socket that reconnects with a backoff, and stops when disposed.
 *
 * The backoff exists because the failure this hits in practice is a platform
 * that is briefly unavailable, and a tight reconnect loop against a rate-limited
 * gateway turns a blip into a ban.
 *
 * @param {Object} options - `{ name, endpoint, onFrame, onClose, log }`.
 * @returns {Object} `{ dispose }`
 */
export function keepSocket({ name, endpoint, onFrame, onClose, log }) {
  let stopped = false
  let ws
  let delay = 1000

  const connect = async () => {
    if (stopped) return
    try {
      const url = await endpoint()
      ws = new WebSocket(url)
      ws.addEventListener('open', () => {
        delay = 1000
        log.info(`[im] ${name}: connected`)
      })
      ws.addEventListener('message', event => {
        let frame
        try {
          frame = JSON.parse(typeof event.data === 'string' ? event.data : String(event.data))
        } catch {
          log.warn(`[im] ${name}: unparsable frame`)
          return
        }
        void Promise.resolve(onFrame(frame, ws)).catch(error => {
          log.warn(`[im] ${name}: handling a frame failed: ${String(error)}`)
        })
      })
      ws.addEventListener('error', () => { /* close follows, and carries the retry */ })
      ws.addEventListener('close', () => {
        onClose?.()
        if (stopped) return
        log.warn(`[im] ${name}: disconnected; retrying in ${delay}ms`)
        // unref: a pending reconnect must not be the reason the host cannot
        // exit — the bridge is a passenger, not the process's purpose.
        setTimeout(connect, delay).unref?.()
        delay = Math.min(delay * 2, 60000)
      })
    } catch (error) {
      if (stopped) return
      log.warn(`[im] ${name}: could not connect (${String(error)}); retrying in ${delay}ms`)
      setTimeout(connect, delay).unref?.()
      delay = Math.min(delay * 2, 60000)
    }
  }

  void connect()

  return {
    dispose() {
      stopped = true
      try {
        ws?.close()
      } catch {
        // already gone
      }
    },
  }
}
