/**
 * Per-platform wire facts, as pure functions.
 *
 * Each platform differs in three ways that matter: how it proves a delivery
 * came from it, where the sender/chat/text live in its payload, and how a
 * reply is addressed. Those are the parts that go wrong silently, so they live
 * here — no sockets, no clock, no credentials beyond what is passed in — and
 * the socket wiring in `channels.js` stays thin enough to read.
 *
 * Two platforms deliver over an HTTP callback (Lark, WeCom) and two over a
 * long-lived socket the client opens (DingTalk Stream, QQ gateway). That
 * difference decides whether a deployment needs a public URL, which is the
 * first thing anyone hits, so it is stated per platform in the README.
 *
 * @module dsh-plugin-im/protocols
 */

import { createHash, createDecipheriv, timingSafeEqual } from 'node:crypto'

/**
 * Constant-time comparison of two signatures.
 *
 * `===` on a signature leaks its correct prefix through timing. The lengths are
 * compared first because timingSafeEqual throws on a mismatch.
 * @param {string} a - the computed signature.
 * @param {string} b - the signature the caller presented.
 * @returns {boolean} whether they match.
 */
export function signatureEquals(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false
  return timingSafeEqual(Buffer.from(a), Buffer.from(b))
}

// ── Lark / 飞书 ─────────────────────────────────────────────────────────────
// Event subscription over an HTTP callback. The long-connection mode is
// deliberately not used: its frames are protobuf, which means the official SDK,
// which means a dependency and a build — this repo has neither.

/**
 * Lark's callback signature: sha256 over timestamp + nonce + token + body.
 * @param {Object} parts - `{ timestamp, nonce, token, body }` as received.
 * @returns {string} the expected signature, hex.
 */
export function larkSignature({ timestamp, nonce, token, body }) {
  return createHash('sha256').update(`${timestamp}${nonce}${token}${body}`).digest('hex')
}

/**
 * Read a Lark callback body.
 *
 * Two shapes arrive at the same route: the one-off URL verification handshake,
 * and an event. The handshake must be answered with the challenge or the app
 * can never be configured, so it is reported as its own kind rather than
 * treated as a malformed event.
 *
 * @param {Object} payload - the parsed JSON body.
 * @returns {Object} `{ kind: 'challenge'|'message'|'ignored', ... }`
 */
export function larkInbound(payload) {
  if (payload?.type === 'url_verification' && typeof payload.challenge === 'string') {
    return { kind: 'challenge', challenge: payload.challenge }
  }
  const event = payload?.event
  if (payload?.header?.event_type !== 'im.message.receive_v1' || event === undefined) {
    return { kind: 'ignored', reason: payload?.header?.event_type ?? 'no event' }
  }
  // Text arrives JSON-encoded inside the message body, and a mention of the bot
  // is left in the text as a placeholder — carrying "@_user_1" into the prompt
  // would put it in front of the model as if it were content.
  let text = ''
  try {
    text = String(JSON.parse(event.message?.content ?? '{}').text ?? '')
  } catch {
    text = ''
  }
  return {
    kind: 'message',
    deliveryId: event.message?.message_id ?? payload.header?.event_id ?? '',
    chatId: event.message?.chat_id ?? '',
    senderId: event.sender?.sender_id?.open_id ?? event.sender?.sender_id?.user_id ?? '',
    text: text.replace(/@_(?:user|all)_\d+/g, '').trim(),
    messageType: event.message?.message_type ?? 'text',
  }
}

// ── WeCom / 企业微信 ────────────────────────────────────────────────────────
// Official app callback: XML body, AES-CBC encrypted, with a sha1 signature
// over the sorted parameters. Personal WeChat has no official bot API at all,
// which is why this plugin speaks WeCom and not WeChat.

/**
 * WeCom's callback signature: sha1 over the sorted parts.
 * @param {Object} parts - `{ token, timestamp, nonce, encrypt }`.
 * @returns {string} the expected msg_signature, hex.
 */
export function wecomSignature({ token, timestamp, nonce, encrypt }) {
  return createHash('sha1').update([token, timestamp, nonce, encrypt].sort().join('')).digest('hex')
}

/**
 * Decrypt a WeCom `Encrypt` payload.
 *
 * The scheme: base64 AES-256-CBC, key is the base64 EncodingAESKey with '=',
 * iv is the key's first 16 bytes, plaintext is
 * `random(16) | length(4, big endian) | message | receiveId`. The trailing
 * receive id is checked because a payload that decrypts but belongs to another
 * corp is a misconfiguration worth failing on, not a message worth handling.
 *
 * @param {Object} parts - `{ encrypt, encodingAesKey, receiveId }`.
 * @returns {string} the decrypted XML message.
 * @throws when the key, padding or receive id does not hold.
 */
export function wecomDecrypt({ encrypt, encodingAesKey, receiveId }) {
  const key = Buffer.from(`${encodingAesKey}=`, 'base64')
  if (key.length !== 32) throw new Error('im: EncodingAESKey must decode to 32 bytes')
  const decipher = createDecipheriv('aes-256-cbc', key, key.subarray(0, 16))
  decipher.setAutoPadding(false)
  const raw = Buffer.concat([decipher.update(Buffer.from(encrypt, 'base64')), decipher.final()])

  // PKCS#7, stripped by hand because auto-padding is off: WeCom pads with a
  // byte count that Node rejects as invalid on some payloads.
  const pad = raw[raw.length - 1]
  if (pad < 1 || pad > 32) throw new Error('im: bad padding on the encrypted payload')
  const body = raw.subarray(16, raw.length - pad)
  const length = body.readUInt32BE(0)
  const message = body.subarray(4, 4 + length).toString('utf8')
  const tail = body.subarray(4 + length).toString('utf8')
  if (receiveId !== undefined && receiveId.length > 0 && tail !== receiveId) {
    throw new Error(`im: payload is addressed to "${tail}", not "${receiveId}"`)
  }
  return message
}

/**
 * Pull one tag's text out of a WeCom XML message.
 *
 * A parser is not warranted: these payloads are a flat list of tags, values
 * arrive in CDATA, and a dependency in this repo has to earn itself.
 * @param {string} xml - the decrypted message.
 * @param {string} tag - the tag to read.
 * @returns {string} the value, or ''.
 */
export function xmlValue(xml, tag) {
  const match = new RegExp(`<${tag}>(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([\\s\\S]*?))</${tag}>`).exec(xml)
  return (match?.[1] ?? match?.[2] ?? '').trim()
}

/**
 * Read a decrypted WeCom message.
 * @param {string} xml - the decrypted XML.
 * @returns {Object} `{ kind: 'message'|'ignored', ... }`
 */
export function wecomInbound(xml) {
  const type = xmlValue(xml, 'MsgType')
  if (type !== 'text') return { kind: 'ignored', reason: type || 'no MsgType' }
  return {
    kind: 'message',
    deliveryId: xmlValue(xml, 'MsgId'),
    // A WeCom app message names the user, not a chat; replies go back to the
    // user, so the user id is also the conversation key.
    chatId: xmlValue(xml, 'FromUserName'),
    senderId: xmlValue(xml, 'FromUserName'),
    text: xmlValue(xml, 'Content'),
    agentId: xmlValue(xml, 'AgentID'),
  }
}

// ── DingTalk / 钉钉 Stream ──────────────────────────────────────────────────
// The client opens the socket, so no public URL is needed. Frames are JSON and
// every delivery must be acknowledged on the same socket or the platform
// redelivers it.

/** Where a Stream connection is negotiated. */
export const DINGTALK_GATEWAY = 'https://api.dingtalk.com/v1.0/gateway/connections/open'

/**
 * The body that opens a Stream connection.
 * @param {Object} credentials - `{ clientId, clientSecret }`.
 * @returns {Object} the JSON body to POST.
 */
export function dingtalkOpenBody({ clientId, clientSecret }) {
  return {
    clientId,
    clientSecret,
    ua: 'dsh-plugin-im/0.1.0',
    subscriptions: [{ type: 'CALLBACK', topic: '/v1.0/im/bot/messages/get' }],
  }
}

/**
 * Read a DingTalk Stream frame.
 * @param {Object} frame - the parsed frame.
 * @returns {Object} `{ kind: 'message'|'system'|'ignored', ... }`
 */
export function dingtalkInbound(frame) {
  const topic = frame?.headers?.topic
  const messageId = frame?.headers?.messageId ?? ''
  if (frame?.type === 'SYSTEM') return { kind: 'system', topic, messageId }
  if (topic !== '/v1.0/im/bot/messages/get') return { kind: 'ignored', reason: topic ?? 'no topic', messageId }

  let data = {}
  try {
    data = JSON.parse(frame.data ?? '{}')
  } catch {
    return { kind: 'ignored', reason: 'unparsable data', messageId }
  }
  return {
    kind: 'message',
    // The ack is keyed by the frame's messageId, while dedupe is keyed by the
    // chat message's own id: a redelivery carries a new frame id.
    messageId,
    deliveryId: data.msgId ?? messageId,
    chatId: data.conversationId ?? '',
    senderId: data.senderStaffId ?? data.senderId ?? '',
    text: String(data.text?.content ?? '').trim(),
    // Replying through this webhook needs no access token, and it expires with
    // the message — which is why the bridge keeps it per conversation.
    replyWebhook: data.sessionWebhook ?? '',
    messageType: data.msgtype ?? 'text',
  }
}

/**
 * The acknowledgement a delivery expects.
 * @param {string} messageId - the frame's messageId.
 * @returns {Object} the frame to send back.
 */
export function dingtalkAck(messageId) {
  return {
    code: 200,
    headers: { contentType: 'application/json', messageId },
    message: 'OK',
    data: '{}',
  }
}

// ── QQ official bot gateway ─────────────────────────────────────────────────
// Opcode-numbered frames over a socket the client opens, like Discord's.

/** Gateway opcodes this bridge uses. */
export const QQ_OP = { DISPATCH: 0, HEARTBEAT: 1, IDENTIFY: 2, RESUME: 6, RECONNECT: 7, INVALID_SESSION: 9, HELLO: 10, HEARTBEAT_ACK: 11 }

/**
 * The identify frame that authenticates the socket.
 *
 * `intents` is a bitfield; the default asks for the two message events a bot
 * can receive without extra approval — group and direct at-mentions.
 * @param {Object} options - `{ appId, token, intents }`.
 * @returns {Object} the frame to send.
 */
export function qqIdentify({ appId, token, intents }) {
  return {
    op: QQ_OP.IDENTIFY,
    d: {
      token: `QQBot ${token}`,
      intents,
      shard: [0, 1],
      properties: { $os: 'linux', $browser: 'dsh-plugin-im', $device: 'dsh' },
      appId,
    },
  }
}

/**
 * Read a QQ gateway frame.
 * @param {Object} frame - the parsed frame.
 * @returns {Object} `{ kind, ... }` — 'hello', 'ack', 'message', 'reconnect', 'ignored'
 */
export function qqInbound(frame) {
  const op = frame?.op
  if (op === QQ_OP.HELLO) return { kind: 'hello', heartbeatMs: Number(frame.d?.heartbeat_interval) || 30000 }
  if (op === QQ_OP.HEARTBEAT_ACK) return { kind: 'ack' }
  if (op === QQ_OP.RECONNECT || op === QQ_OP.INVALID_SESSION) return { kind: 'reconnect', op }
  if (op !== QQ_OP.DISPATCH) return { kind: 'ignored', reason: `op ${op}` }

  const data = frame.d ?? {}
  const type = frame.t
  if (type !== 'AT_MESSAGE_CREATE' && type !== 'DIRECT_MESSAGE_CREATE' && type !== 'GROUP_AT_MESSAGE_CREATE') {
    return { kind: 'ignored', reason: type ?? 'no type', sequence: frame.s }
  }
  return {
    kind: 'message',
    sequence: frame.s,
    deliveryId: data.id ?? '',
    // A group message replies to the group; a direct message replies to the
    // author's channel, so both ids are carried and the sender picks.
    chatId: data.group_openid ?? data.channel_id ?? data.guild_id ?? '',
    groupOpenId: data.group_openid ?? '',
    channelId: data.channel_id ?? '',
    senderId: data.author?.member_openid ?? data.author?.user_openid ?? data.author?.id ?? '',
    // The mention of the bot is part of the text on this platform.
    text: String(data.content ?? '').replace(/<@!?\d+>/g, '').trim(),
    messageId: data.id ?? '',
  }
}
