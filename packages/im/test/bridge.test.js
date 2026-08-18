import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createBridge, createRoutes } from '../lib/bridge.js'

/**
 * A host with one attachable agent per session, and a hand-cranked session
 * event stream. This stands in for `ctx.agents` and `ctx.on('session/event')`,
 * whose real shapes were read out of the installed runtime — so what is being
 * tested is the bridge's behaviour, not a re-description of the host.
 * @returns {Object} the fake context plus what it recorded
 */
function fakeHost() {
  const agents = new Map()
  const created = []
  const cancelled = []
  const submitted = []
  let listener

  const makeAgent = sessionId => ({
    session: { id: sessionId, header: { cwd: '/work' } },
    followup: message => submitted.push({ sessionId, message }),
    steer: message => submitted.push({ sessionId, message, steer: true }),
    cancel: (source, options) => cancelled.push({ sessionId, source, options }),
  })

  const ctx = {
    agents: {
      get: sessionId => agents.get(sessionId),
      create: async ({ sessionId, meta, setup }) => {
        created.push({ sessionId, meta })
        await setup?.({})
        const agent = makeAgent(sessionId)
        agents.set(sessionId, agent)
        return { agent }
      },
    },
    get: () => undefined,
    on: (event, callback) => {
      assert.equal(event, 'session/event')
      listener = callback
      return () => { listener = undefined }
    },
  }

  return {
    ctx,
    created,
    cancelled,
    submitted,
    agents,
    /** Feed one session event, the way the host would. */
    emit: (sessionId, type, data) => listener?.({ id: sessionId }, { type, data }),
    hasListener: () => listener !== undefined,
  }
}

/** A channel that records what it would have sent. */
function fakeChannel(name = 'lark') {
  const sent = []
  return { channel: { name, send: async (inbound, text) => { sent.push(text) } }, sent }
}

const CONFIG = {
  allowFrom: ['ou_me'],
  cwd: '/work',
  agentPreset: '',
  replyChars: 60,
  refusalNotice: '',
}

const silent = { info: () => {}, warn: () => {} }

/** @returns {Object} a bridge over a fresh fake host */
function setup(config = {}) {
  const host = fakeHost()
  const routes = createRoutes(undefined)
  const bridge = createBridge(host.ctx, { config: { ...CONFIG, ...config }, routes, log: silent })
  return { host, bridge, routes }
}

const message = (text, senderId = 'ou_me', chatId = 'oc_1') => ({ text, senderId, chatId, deliveryId: 'd1' })

test('an unauthorised sender drives nothing', async () => {
  const { host, bridge } = setup()
  const { channel, sent } = fakeChannel()

  await bridge.handle(message('rm -rf /', 'ou_stranger'), channel)
  assert.deepEqual(host.created, [], 'no session is created for someone not on the list')
  assert.deepEqual(host.submitted, [])
  assert.deepEqual(sent, [], 'silence by default: a refusal notice would confirm the bot exists')
})

test('a refusal notice is sent only when one is configured', async () => {
  const { bridge } = setup({ refusalNotice: 'not authorised' })
  const { channel, sent } = fakeChannel()
  await bridge.handle(message('hi', 'ou_stranger'), channel)
  assert.deepEqual(sent, ['not authorised'])
})

test('a first message creates a session and hands over the text', async () => {
  const { host, bridge, routes } = setup()
  const { channel } = fakeChannel()

  await bridge.handle(message('what changed today?'), channel)

  assert.equal(host.created.length, 1)
  assert.equal(host.created[0].meta.cwd, '/work')
  assert.equal(host.submitted.length, 1)
  assert.deepEqual(host.submitted[0].message.content, [{ type: 'text', text: 'what changed today?' }])
  assert.equal(await routes.get('lark:oc_1'), host.created[0].sessionId, 'the chat is bound to its session')
})

test('the same chat keeps its session across messages', async () => {
  const { host, bridge } = setup()
  const { channel } = fakeChannel()

  await bridge.handle(message('first'), channel)
  await bridge.handle(message('second'), channel)

  assert.equal(host.created.length, 1, 'a new session per message would restart the conversation each time')
  assert.equal(host.submitted.length, 2)
})

test('two chats get two sessions', async () => {
  const { host, bridge } = setup()
  const { channel } = fakeChannel()

  await bridge.handle(message('a', 'ou_me', 'oc_1'), channel)
  await bridge.handle(message('b', 'ou_me', 'oc_2'), channel)
  assert.equal(host.created.length, 2)
})

test('the reply reaches the chat when the turn ends', async () => {
  const { host, bridge } = setup()
  const { channel, sent } = fakeChannel()

  await bridge.handle(message('summarise'), channel)
  const sessionId = host.created[0].sessionId

  host.emit(sessionId, 'assistant/message', { message: { content: [{ type: 'text', text: 'Two commits.' }] } })
  assert.deepEqual(sent, [], 'nothing is sent mid-turn; a chat is not a stream')

  host.emit(sessionId, 'turn/end', {})
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(sent, ['Two commits.'])
})

test('a long reply arrives in labelled pieces', async () => {
  const { host, bridge } = setup()
  const { channel, sent } = fakeChannel()

  await bridge.handle(message('explain'), channel)
  const sessionId = host.created[0].sessionId
  host.emit(sessionId, 'assistant/message', { message: { content: [{ type: 'text', text: 'word '.repeat(40) }] } })
  host.emit(sessionId, 'turn/end', {})
  await new Promise(resolve => setImmediate(resolve))

  assert.ok(sent.length > 1)
  assert.match(sent[0], /^\[1\/\d+\]/)
})

test('a turn that only ran tools says so instead of sending nothing', async () => {
  const { host, bridge } = setup()
  const { channel, sent } = fakeChannel()

  await bridge.handle(message('fix the build'), channel)
  const sessionId = host.created[0].sessionId
  host.emit(sessionId, 'tool/call', {})
  host.emit(sessionId, 'tool/call', {})
  host.emit(sessionId, 'turn/end', {})
  await new Promise(resolve => setImmediate(resolve))

  assert.equal(sent.length, 1)
  assert.match(sent[0], /2 tool call/)
})

test('a turn the bridge did not start is not echoed to any chat', async () => {
  // Someone typing in the web UI has a running session too. Forwarding it
  // would leak that conversation into a chat app.
  const { host, bridge } = setup()
  const { channel, sent } = fakeChannel()
  await bridge.handle(message('hello'), channel)
  host.emit(host.created[0].sessionId, 'turn/end', {})
  await new Promise(resolve => setImmediate(resolve))
  sent.length = 0

  host.emit('session-typed-in-the-web-ui', 'assistant/message', { message: { content: [{ type: 'text', text: 'private' }] } })
  host.emit('session-typed-in-the-web-ui', 'turn/end', {})
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(sent, [])
})

test('/new starts a second session for the same chat', async () => {
  const { host, bridge } = setup()
  const { channel, sent } = fakeChannel()

  await bridge.handle(message('first'), channel)
  await bridge.handle(message('/new'), channel)

  assert.equal(host.created.length, 2)
  assert.match(sent[0], /Started a new session/)
  await bridge.handle(message('second'), channel)
  assert.equal(host.submitted.at(-1).sessionId, host.created[1].sessionId, 'later messages go to the new session')
})

test('/stop cancels the running turn and keeps the queue', async () => {
  const { host, bridge } = setup()
  const { channel, sent } = fakeChannel()

  await bridge.handle(message('long job'), channel)
  await bridge.handle(message('/stop'), channel)

  assert.equal(host.cancelled.length, 1)
  assert.deepEqual(host.cancelled[0].source, { kind: 'user' })
  assert.deepEqual(host.cancelled[0].options, { keepInbox: true },
    'a queued line must not be thrown away with the turn being interrupted')
  assert.match(sent.at(-1), /Cancelled/)
})

test('/stop and /status before there is a session say so plainly', async () => {
  const { bridge } = setup()
  const { channel, sent } = fakeChannel()

  await bridge.handle(message('/stop'), channel)
  await bridge.handle(message('/status'), channel)
  assert.match(sent[0], /no session/)
  assert.match(sent[1], /No session yet/)
})

test('/status reports the session, the workspace and whether it is busy', async () => {
  const { host, bridge } = setup()
  const { channel, sent } = fakeChannel()

  await bridge.handle(message('work'), channel)
  await bridge.handle(message('/status'), channel)
  assert.match(sent.at(-1), /A turn is running/)

  host.emit(host.created[0].sessionId, 'turn/end', {})
  await new Promise(resolve => setImmediate(resolve))
  await bridge.handle(message('/status'), channel)
  assert.match(sent.at(-1), /Idle/)
  assert.match(sent.at(-1), /\/work/)
})

test('/help lists the commands', async () => {
  // replyChars is 60 in these tests, so help itself is split — checking the
  // joined pieces is checking what the reader actually receives.
  const { bridge } = setup()
  const { channel, sent } = fakeChannel()
  await bridge.handle(message('/help'), channel)
  const help = sent.join(' ')
  for (const command of ['/new', '/stop', '/status', '/help']) assert.ok(help.includes(command), command)
})

test('a mapped session that is no longer attached is replaced, not reported', async () => {
  // After a restart the mapping survives but nothing is attached. From a phone,
  // an error nobody can act on is worse than a fresh session.
  const { host, bridge, routes } = setup()
  const { channel } = fakeChannel()
  await routes.set('lark:oc_1', 'session-gone')

  await bridge.handle(message('still there?'), channel)
  assert.equal(host.created.length, 1)
  assert.notEqual(host.created[0].sessionId, 'session-gone')
  assert.equal(await routes.get('lark:oc_1'), host.created[0].sessionId)
})

test('the event subscription is released on dispose', () => {
  const { host, bridge } = setup()
  assert.equal(host.hasListener(), true)
  bridge.dispose()
  assert.equal(host.hasListener(), false)
})

test('a route store backed by a table reads and writes through it', async () => {
  const rows = new Map()
  const routes = createRoutes({
    get: async key => rows.get(key),
    put: async (key, value) => { rows.set(key, value) },
  })

  assert.equal(await routes.get('lark:oc_9'), undefined)
  await routes.set('lark:oc_9', 'session-9')
  assert.equal(await routes.get('lark:oc_9'), 'session-9')
  assert.equal(typeof rows.get('lark:oc_9').at, 'number', 'the mapping records when it was made')
})
