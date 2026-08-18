/**
 * Who is allowed, and how someone becomes allowed without editing a config
 * file twice.
 *
 * The problem this solves: the ids these platforms report are opaque
 * (`ou_3f8c…`, a QQ openid), so an operator cannot know their own before the
 * bot has already refused them once. The old answer was "read the log, paste
 * the id, restart" — two restarts and a log grep before the first useful
 * message.
 *
 * Instead a one-time code is printed **to the local log** at startup, and the
 * first sender who sends that code back is added to the allowlist and
 * persisted. The security property is unchanged: only someone who can read
 * this machine's log can pair, and that is someone who already has the
 * machine. It is not a password sent over the chat — it authorises the
 * *sender's id*, once, and is then spent.
 *
 * @module dsh-plugin-im/access
 */

import { randomInt } from 'node:crypto'

/** Digits in a pairing code: enough that guessing it in a chat is hopeless. */
const CODE_DIGITS = 6

/**
 * A single-use pairing code with a deadline.
 *
 * Single-use because a code that keeps working is a standing key to the
 * machine, and it lives in a log file that gets pasted into issues.
 *
 * @param {Object} options - `{ ttlMs, now }`, `now` injectable for tests.
 * @returns {Object} `{ code, offer(), matches(text), consume(), state() }`
 */
export function createPairing({ ttlMs = 30 * 60 * 1000, now = () => Date.now() } = {}) {
  const code = String(randomInt(0, 10 ** CODE_DIGITS)).padStart(CODE_DIGITS, '0')
  const expiresAt = now() + ttlMs
  let spent = false

  return {
    code,
    /** @returns {boolean} whether the code can still be used. */
    live: () => !spent && now() < expiresAt,
    /**
     * Whether a chat line is this code.
     *
     * Compared against the trimmed line only — not "contains" — so a message
     * that happens to quote the code while asking about it does not pair.
     * @param {string} text - the chat line.
     * @returns {boolean} whether it is the code, and the code is still live.
     */
    matches(text) {
      if (!this.live()) return false
      return String(text ?? '').trim().replace(/\s+/g, '') === code
    },
    /** Spend the code, so a second sender cannot reuse it. */
    consume() {
      spent = true
    },
    /** @returns {string} why the code cannot be used, or 'live'. */
    state: () => (spent ? 'spent' : now() < expiresAt ? 'live' : 'expired'),
  }
}

/**
 * The access decision, over a configured list plus whatever has been paired.
 *
 * Pairing is only offered while nobody is allowed at all. Once there is one
 * authorised sender, an unknown sender is simply refused — a bridge that keeps
 * accepting new pairings is a bridge that anyone who sees a code in a
 * screenshot can join.
 *
 * @param {Object} options - `{ configured, table, pairing, log, onPaired }`.
 * @returns {Object} `{ allows, claim, pairingCode, ready }`
 */
export function createAccess({ configured = [], table, pairing, log }) {
  // Paired ids are kept in memory as well as in storage: the decision is on the
  // hot path of every message, and storage may not be composed at all.
  const paired = new Set()
  const persist = async senderId => {
    if (table === undefined) return
    try {
      await table.put(senderId, { at: Date.now() })
    } catch (error) {
      log.warn(`[im] paired ${senderId} but could not persist it: ${String(error)}`)
    }
  }

  return {
    /**
     * Load previously paired ids, so pairing survives a restart.
     * @returns {Promise<number>} how many were restored
     */
    async restore() {
      if (table === undefined) return 0
      try {
        for (const [senderId] of table.entries()) paired.add(senderId)
      } catch (error) {
        log.warn(`[im] could not read paired senders: ${String(error)}`)
      }
      return paired.size
    },
    /**
     * @param {string} senderId - the platform's id for the sender.
     * @returns {boolean} whether they may drive the agent.
     */
    allows(senderId) {
      if (typeof senderId !== 'string' || senderId.length === 0) return false
      return configured.includes(senderId) || paired.has(senderId)
    },
    /** @returns {boolean} whether anyone at all is authorised. */
    anyone: () => configured.length > 0 || paired.size > 0,
    /**
     * The code to print, while one is on offer.
     * @returns {string|undefined} the code, or undefined when pairing is closed
     */
    pairingCode() {
      if (pairing === undefined || this.anyone() || !pairing.live()) return undefined
      return pairing.code
    },
    /**
     * Try to pair this sender with a chat line.
     * @param {string} senderId - the sender to authorise.
     * @param {string} text - the line they sent.
     * @returns {Promise<boolean>} whether they are now authorised
     */
    async claim(senderId, text) {
      if (this.pairingCode() === undefined) return false
      if (!pairing.matches(text)) return false
      pairing.consume()
      paired.add(senderId)
      await persist(senderId)
      log.warn(`[im] paired ${senderId}; the code is now spent`)
      return true
    },
  }
}
