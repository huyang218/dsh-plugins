import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createCipheriv, createHash, randomBytes } from 'node:crypto'
import {
  DINGTALK_GATEWAY, QQ_OP, dingtalkAck, dingtalkInbound, dingtalkOpenBody,
  larkInbound, larkSignature, qqIdentify, qqInbound, signatureEquals,
  wecomDecrypt, wecomInbound, wecomSignature, xmlValue,
} from '../lib/protocols.js'

test('signature comparison rejects a mismatch and a length difference', () => {
  const digest = createHash('sha256').update('x').digest('hex')
  assert.equal(signatureEquals(digest, digest), true)
  assert.equal(signatureEquals(digest, digest.slice(0, -1)), false, 'a shorter presentation is not a match')
  assert.equal(signatureEquals(digest, `${digest.slice(0, -1)}0`), false)
  assert.equal(signatureEquals(digest, undefined), false)
})

// ── Lark ────────────────────────────────────────────────────────────────────

test('the Lark signature covers timestamp, nonce, token and body', () => {
  const parts = { timestamp: '1700000000', nonce: 'n1', token: 'tok', body: '{"a":1}' }
  const expected = createHash('sha256').update('1700000000n1tok{"a":1}').digest('hex')
  assert.equal(larkSignature(parts), expected)
  // Every part must matter, or a replay with a different timestamp still passes.
  assert.notEqual(larkSignature({ ...parts, timestamp: '1700000001' }), expected)
  assert.notEqual(larkSignature({ ...parts, body: '{"a":2}' }), expected)
})

test('the Lark URL handshake is answered, not treated as an event', () => {
  // Without this the app can never be configured in the first place.
  const inbound = larkInbound({ type: 'url_verification', challenge: 'abc123' })
  assert.deepEqual(inbound, { kind: 'challenge', challenge: 'abc123' })
})

test('a Lark message is read out of its JSON-encoded content', () => {
  const inbound = larkInbound({
    header: { event_type: 'im.message.receive_v1', event_id: 'evt1' },
    event: {
      sender: { sender_id: { open_id: 'ou_me' } },
      message: { message_id: 'om_1', chat_id: 'oc_1', message_type: 'text', content: '{"text":"@_user_1 ship it"}' },
    },
  })

  assert.equal(inbound.kind, 'message')
  assert.equal(inbound.senderId, 'ou_me')
  assert.equal(inbound.chatId, 'oc_1')
  assert.equal(inbound.deliveryId, 'om_1')
  // The mention placeholder would otherwise be handed to the model as content.
  assert.equal(inbound.text, 'ship it')
})

test('a Lark event of another type is ignored with its reason', () => {
  assert.equal(larkInbound({ header: { event_type: 'im.chat.updated_v1' } }).kind, 'ignored')
  assert.equal(larkInbound({}).kind, 'ignored')
  // Unparsable content must not throw inside a callback handler.
  const broken = larkInbound({
    header: { event_type: 'im.message.receive_v1' },
    event: { message: { content: 'not json' } },
  })
  assert.equal(broken.kind, 'message')
  assert.equal(broken.text, '')
})

// ── WeCom ───────────────────────────────────────────────────────────────────

test('the WeCom signature is sha1 over the sorted parts', () => {
  const parts = { token: 'tok', timestamp: '17', nonce: 'n', encrypt: 'e' }
  const expected = createHash('sha1').update(['tok', '17', 'n', 'e'].sort().join('')).digest('hex')
  assert.equal(wecomSignature(parts), expected)
})

/**
 * Encrypt a message the way WeCom does, so the decryption path can be tested
 * without a corp account.
 * @param {Object} options - `{ message, key, receiveId }`.
 * @returns {string} the base64 payload
 */
function wecomEncrypt({ message, key, receiveId }) {
  const body = Buffer.from(message, 'utf8')
  const length = Buffer.alloc(4)
  length.writeUInt32BE(body.length, 0)
  const plain = Buffer.concat([randomBytes(16), length, body, Buffer.from(receiveId, 'utf8')])
  const pad = 32 - (plain.length % 32)
  const padded = Buffer.concat([plain, Buffer.alloc(pad, pad)])
  const cipher = createCipheriv('aes-256-cbc', key, key.subarray(0, 16))
  cipher.setAutoPadding(false)
  return Buffer.concat([cipher.update(padded), cipher.final()]).toString('base64')
}

const AES_KEY = randomBytes(32)
const ENCODING_AES_KEY = AES_KEY.toString('base64').slice(0, 43)

test('a WeCom payload round-trips through the documented scheme', () => {
  const key = Buffer.from(`${ENCODING_AES_KEY}=`, 'base64')
  const xml = '<xml><ToUserName><![CDATA[corp]]></ToUserName><MsgType><![CDATA[text]]></MsgType><Content><![CDATA[deploy?]]></Content><FromUserName><![CDATA[zhang]]></FromUserName><MsgId>123</MsgId><AgentID>7</AgentID></xml>'
  const encrypt = wecomEncrypt({ message: xml, key, receiveId: 'corp-1' })

  assert.equal(wecomDecrypt({ encrypt, encodingAesKey: ENCODING_AES_KEY, receiveId: 'corp-1' }), xml)
  // A payload that decrypts but belongs to another corp is a misconfiguration
  // to fail on, not a message to act on.
  assert.throws(
    () => wecomDecrypt({ encrypt, encodingAesKey: ENCODING_AES_KEY, receiveId: 'corp-2' }),
    /addressed to "corp-1"/,
  )
})

test('a WeCom key of the wrong length fails by name', () => {
  assert.throws(() => wecomDecrypt({ encrypt: 'AAAA', encodingAesKey: 'short' }), /32 bytes/)
})

test('WeCom XML values come out of CDATA and plain tags alike', () => {
  assert.equal(xmlValue('<A><![CDATA[in cdata]]></A>', 'A'), 'in cdata')
  assert.equal(xmlValue('<B>7</B>', 'B'), '7')
  assert.equal(xmlValue('<A>x</A>', 'missing'), '')
})

test('a WeCom text message names the user as the conversation', () => {
  const inbound = wecomInbound('<xml><MsgType><![CDATA[text]]></MsgType><Content><![CDATA[hi]]></Content><FromUserName><![CDATA[zhang]]></FromUserName><MsgId>9</MsgId><AgentID>7</AgentID></xml>')
  assert.equal(inbound.kind, 'message')
  assert.equal(inbound.text, 'hi')
  assert.equal(inbound.senderId, 'zhang')
  assert.equal(inbound.chatId, 'zhang', 'a reply goes back to the user, so the user is the chat')
  assert.equal(inbound.deliveryId, '9')
  assert.equal(wecomInbound('<xml><MsgType><![CDATA[image]]></MsgType></xml>').kind, 'ignored')
})

// ── DingTalk ────────────────────────────────────────────────────────────────

test('the DingTalk open request subscribes to bot messages', () => {
  const body = dingtalkOpenBody({ clientId: 'id', clientSecret: 'secret' })
  assert.equal(body.clientId, 'id')
  assert.deepEqual(body.subscriptions, [{ type: 'CALLBACK', topic: '/v1.0/im/bot/messages/get' }])
  assert.match(DINGTALK_GATEWAY, /^https:\/\/api\.dingtalk\.com\//)
})

test('a DingTalk frame yields both ids: one to ack, one to dedupe', () => {
  const inbound = dingtalkInbound({
    type: 'CALLBACK',
    headers: { topic: '/v1.0/im/bot/messages/get', messageId: 'frame-1' },
    data: JSON.stringify({
      msgId: 'msg-1',
      conversationId: 'cid',
      senderStaffId: 'staff-1',
      text: { content: ' build it ' },
      sessionWebhook: 'https://oapi.dingtalk.com/robot/sendBySession?session=x',
    }),
  })

  assert.equal(inbound.kind, 'message')
  // The ack is keyed by the frame; dedupe by the message — a redelivery carries
  // a new frame id, so acking by the message id would never stop the retries.
  assert.equal(inbound.messageId, 'frame-1')
  assert.equal(inbound.deliveryId, 'msg-1')
  assert.equal(inbound.senderId, 'staff-1')
  assert.equal(inbound.text, 'build it')
  assert.match(inbound.replyWebhook, /sendBySession/)
})

test('DingTalk system frames and other topics are separated', () => {
  assert.equal(dingtalkInbound({ type: 'SYSTEM', headers: { topic: 'ping', messageId: 'f' } }).kind, 'system')
  assert.equal(dingtalkInbound({ headers: { topic: '/other' } }).kind, 'ignored')
  // Unparsable data still surfaces its frame id, because the frame must be
  // acknowledged or the platform redelivers it forever.
  const broken = dingtalkInbound({ headers: { topic: '/v1.0/im/bot/messages/get', messageId: 'f2' }, data: '{' })
  assert.equal(broken.kind, 'ignored')
  assert.equal(broken.messageId, 'f2')
})

test('the acknowledgement carries the frame id back', () => {
  assert.deepEqual(dingtalkAck('f1'), {
    code: 200,
    headers: { contentType: 'application/json', messageId: 'f1' },
    message: 'OK',
    data: '{}',
  })
})

// ── QQ ──────────────────────────────────────────────────────────────────────

test('the QQ identify frame carries the prefixed token', () => {
  const frame = qqIdentify({ appId: '102', token: 'tok', intents: 5 })
  assert.equal(frame.op, QQ_OP.IDENTIFY)
  assert.equal(frame.d.token, 'QQBot tok', 'the scheme prefix is part of the value on this platform')
  assert.equal(frame.d.intents, 5)
})

test('QQ opcodes are read as what they mean', () => {
  assert.deepEqual(qqInbound({ op: 10, d: { heartbeat_interval: 41250 } }), { kind: 'hello', heartbeatMs: 41250 })
  assert.equal(qqInbound({ op: 11 }).kind, 'ack')
  assert.equal(qqInbound({ op: 7 }).kind, 'reconnect')
  assert.equal(qqInbound({ op: 9 }).kind, 'reconnect', 'an invalid session also means reconnect')
  assert.equal(qqInbound({ op: 10, d: {} }).heartbeatMs, 30000, 'a missing interval still has to have one')
})

test('a QQ group mention gives the group to reply to and strips the mention', () => {
  const inbound = qqInbound({
    op: 0,
    s: 42,
    t: 'GROUP_AT_MESSAGE_CREATE',
    d: { id: 'msg1', group_openid: 'grp1', author: { member_openid: 'mem1' }, content: '<@!123456> status?' },
  })

  assert.equal(inbound.kind, 'message')
  assert.equal(inbound.sequence, 42, 'the sequence is what the next heartbeat reports')
  assert.equal(inbound.groupOpenId, 'grp1')
  assert.equal(inbound.senderId, 'mem1')
  assert.equal(inbound.text, 'status?')
  assert.equal(inbound.messageId, 'msg1', 'a passive reply quotes the message it answers')
})

test('a QQ event type this bridge does not handle keeps its sequence', () => {
  // The sequence has to keep advancing even for ignored dispatches, or the
  // heartbeat reports a stale one and the gateway resends from there.
  const ignored = qqInbound({ op: 0, s: 43, t: 'GUILD_MEMBER_ADD', d: {} })
  assert.equal(ignored.kind, 'ignored')
  assert.equal(ignored.sequence, 43)
})
