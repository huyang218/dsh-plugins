/**
 * The host half of the bridge: a chat line goes in, an agent turn happens, the
 * reply comes back out.
 *
 * Every host call here was read out of the installed runtime rather than
 * guessed, because getting one wrong fails at the first message from a phone,
 * which is the worst place to debug:
 *
 *   ctx.agents.get(sessionId)                       an attached agent, or none
 *   ctx.agents.create({ sessionId, agentOptions, meta, setup })
 *   agent.followup(message) / agent.steer(message)  queue, or interrupt
 *   agent.cancel({ kind: 'user' }, { keepInbox: true })
 *   createUserMessage({ content, source })          from @deepseek-ai/dsh-llm
 *   ctx.on('session/event', (session, event) => …)  assistant/message, turn/end
 *
 * @module dsh-plugin-im/bridge
 */

import { randomUUID } from 'node:crypto'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { assistantText, emptyTurnNote, helpText, isAllowed, messages, parseLine, segment } from './policy.js'

/**
 * Wire the chat side to the session side.
 *
 * @param {Object} ctx - the plugin context, with `agents` and `sessions`.
 * @param {Object} options - `{ config, routes, log }`.
 * @returns {Object} `{ handle, dispose }` — `handle(inbound, channel)` per message
 */
export function createBridge(ctx, { config, routes, log }) {
  const say = messages(config.language)

  // sessionId -> what to do with this turn's output. A turn the bridge did not
  // start (someone typing in the web UI) has no entry here and is left alone:
  // a chat bridge that echoes another surface's conversation is a surprise, not
  // a feature.
  const awaiting = new Map()

  const dispose = ctx.on('session/event', (session, event) => {
    const pending = awaiting.get(session.id)
    if (pending === undefined) return

    if (event.type === 'assistant/message') {
      const text = assistantText(event.data?.message ?? event.data)
      if (text.length > 0) pending.parts.push(text)
      return
    }
    if (event.type === 'tool/call') {
      pending.tools += 1
      return
    }
    if (event.type !== 'turn/end') return

    awaiting.delete(session.id)
    const body = pending.parts.join('\n\n')
    const text = body.trim().length > 0
      ? body
      : emptyTurnNote({ tools: pending.tools, cancelled: event.data?.reason === 'cancelled' }, config.language)
    void pending.reply(text).catch(error => {
      log.warn(`[im] could not deliver a reply to ${pending.chatKey}: ${String(error)}`)
    })
  })

  /**
   * Send a reply back to one chat, in pieces a chat window accepts.
   * @param {Object} channel - the channel that delivered the message.
   * @param {Object} inbound - the message being answered.
   * @returns {Function} a function taking the reply text
   */
  function replier(channel, inbound) {
    return async text => {
      for (const piece of segment(text, config.replyChars)) {
        await channel.send(inbound, piece)
      }
    }
  }

  /**
   * The agent driving one chat, attaching or creating as needed.
   *
   * A chat keeps its session across messages — losing it would restart the
   * conversation on every line — and the mapping outlives a restart, so the
   * phone picks up where it left off.
   *
   * @param {string} chatKey - `channel:chatId`.
   * @param {boolean} fresh - start a new session even if one is mapped.
   * @returns {Promise<Object>} the attached agent
   */
  async function agentFor(chatKey, fresh = false) {
    const known = fresh ? undefined : await routes.get(chatKey)
    if (known !== undefined) {
      const attached = ctx.agents.get(known)
      if (attached !== undefined) return attached
      // The session existed but nothing is attached — the process restarted, or
      // it was closed in the web UI. A new one is better than an error the user
      // cannot act on from a phone.
      log.warn(`[im] session ${known} for ${chatKey} is no longer attached; starting a new one`)
    }

    const sessionId = `session-${randomUUID()}`
    const presets = ctx.get('agentPresets')
    const preset = presets === undefined ? undefined : await presets.resolve(config.agentPreset || undefined)
    const created = await ctx.agents.create({
      sessionId,
      agentOptions: ctx.get('agentDefaultModel')?.defaultModelSelection?.() ?? {},
      meta: {
        cwd: config.cwd,
        ...preset === undefined ? {} : { agentPreset: preset.id },
      },
      setup: async agentCtx => {
        if (presets !== undefined && preset !== undefined) await presets.mount(agentCtx, preset.id)
      },
    })
    await routes.set(chatKey, sessionId)
    return created.agent
  }

  /**
   * Act on one inbound chat message.
   * @param {Object} inbound - the parsed message from a channel.
   * @param {Object} channel - the channel it came from, for replies.
   * @returns {Promise<void>} resolves once the message is accepted or refused
   */
  async function handle(inbound, channel) {
    const chatKey = `${channel.name}:${inbound.chatId}`
    const reply = replier(channel, inbound)

    if (!isAllowed(config.allowFrom, inbound.senderId)) {
      // Say who was refused, in the log only: telling the chat which ids are
      // allowed would let anyone enumerate them.
      log.warn(`[im] refused ${channel.name} sender ${inbound.senderId || '(no id)'} — not in allowFrom`)
      if (config.refusalNotice.length > 0) await reply(config.refusalNotice)
      return
    }

    const line = parseLine(inbound.text)
    if (line.kind === 'empty') return
    if (line.kind === 'command') {
      await runCommand(line, { chatKey, reply })
      return
    }

    const agent = await agentFor(chatKey)
    // Only one turn's output is tracked per session, so a second line while the
    // first is still running is queued rather than raced: followup() lands it
    // on the next turn, and the reply that comes back covers both.
    awaiting.set(agent.session.id, { chatKey, parts: [], tools: 0, reply })
    try {
      agent.followup(createUserMessage({
        content: [{ type: 'text', text: line.text }],
        source: { kind: 'user' },
      }))
    } catch (error) {
      awaiting.delete(agent.session.id)
      await reply(say.handoffFailed(String(error)))
    }
  }

  /**
   * Run one chat command.
   * @param {Object} line - the parsed command.
   * @param {Object} context - `{ chatKey, reply }`.
   * @returns {Promise<void>} resolves when the chat has been answered
   */
  async function runCommand(line, { chatKey, reply }) {
    if (line.name === '/help') {
      await reply(helpText(config.language))
      return
    }
    if (line.name === '/new') {
      const agent = await agentFor(chatKey, true)
      await reply(say.newSession(agent.session.id))
      return
    }

    const sessionId = await routes.get(chatKey)
    const agent = sessionId === undefined ? undefined : ctx.agents.get(sessionId)

    if (line.name === '/status') {
      if (agent === undefined) {
        await reply(say.noSessionYet)
        return
      }
      await reply(say.status({
        id: agent.session.id,
        cwd: agent.session.header?.cwd ?? '(unknown)',
        busy: awaiting.has(agent.session.id),
      }))
      return
    }
    if (line.name === '/stop') {
      // Report what is true: cancelling an idle session and answering
      // "cancelled" teaches the reader that /stop does nothing observable, and
      // the next time a turn really is stuck they will not trust it.
      if (agent === undefined || !awaiting.has(agent.session.id)) {
        await reply(say.nothingToStop)
        return
      }
      // keepInbox so a queued line is not silently thrown away along with the
      // turn the user meant to interrupt.
      agent.cancel({ kind: 'user' }, { keepInbox: true })
      await reply(say.cancelled)
    }
  }

  return { handle, dispose }
}

/**
 * Where a chat's session id is remembered.
 *
 * Storage-backed when a backend is composed, in memory otherwise: a bridge that
 * refuses to load without persistence would be worse than one that forgets its
 * mapping on restart, and the mapping is rebuildable by sending a message.
 *
 * @param {Object} table - a storage table, or undefined.
 * @returns {Object} `{ get, set }` over chat keys
 */
export function createRoutes(table) {
  const memory = new Map()
  if (table === undefined) {
    return {
      get: async key => memory.get(key),
      set: async (key, sessionId) => { memory.set(key, sessionId) },
    }
  }
  return {
    get: async key => (await table.get(key))?.sessionId,
    set: async (key, sessionId) => { await table.put(key, { sessionId, at: Date.now() }) },
  }
}
