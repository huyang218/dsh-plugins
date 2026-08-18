/**
 * Channel-independent decisions: who may command the agent, which deliveries
 * are duplicates, what a chat line means, and how a reply is cut up to fit a
 * chat window.
 *
 * All of it is pure. The platform modules deal in sockets and signatures; this
 * file is where the rules live, so the rules can be tested without a network,
 * a credential, or a phone.
 *
 * @module dsh-plugin-im/policy
 */

/** Commands understood in a chat line, and what each one means. */
export const COMMANDS = {
  '/new': 'start a fresh session for this chat',
  '/stop': 'cancel the turn that is running',
  '/status': 'report which session this chat drives and whether it is busy',
  '/help': 'list these commands',
}

/**
 * Whether a sender may drive the agent.
 *
 * Fail-closed by design: an empty allowlist admits nobody. A chat bridge is a
 * remote control for a machine with file and shell access, and the failure mode
 * of an open default is not a broken feature — it is a stranger's message
 * running as you. Ids are compared exactly; there are no wildcards, because a
 * pattern in this position is a way to be surprised.
 *
 * @param {string[]} allowlist - configured sender ids.
 * @param {string} senderId - the id the platform reports for the sender.
 * @returns {boolean} whether the message may be acted on.
 */
export function isAllowed(allowlist, senderId) {
  if (!Array.isArray(allowlist) || allowlist.length === 0) return false
  if (typeof senderId !== 'string' || senderId.length === 0) return false
  return allowlist.includes(senderId)
}

/**
 * A bounded set of delivery ids already handled.
 *
 * Every one of these platforms retries a callback it thinks failed, and a
 * retried message that runs twice means the agent does the work twice — with
 * shell access, that is not merely noisy. Bounded because a bridge left running
 * for weeks must not grow a set of every message it ever saw.
 *
 * @param {number} capacity - how many ids to remember.
 * @returns {Object} `seen(id)` returning true when the id was already present
 */
export function createDedupe(capacity = 500) {
  const ids = new Set()
  return {
    seen(id) {
      if (typeof id !== 'string' || id.length === 0) return false
      if (ids.has(id)) return true
      ids.add(id)
      if (ids.size > capacity) ids.delete(ids.values().next().value)
      return false
    },
    get size() {
      return ids.size
    },
  }
}

/**
 * Read a chat line as either a command or a prompt.
 *
 * A line is only a command when it starts with a known one, so a message that
 * happens to begin with a slash — a path, a regex, `/usr/local/bin` — is
 * carried through to the model rather than rejected as an unknown command.
 *
 * @param {string} text - the raw chat line.
 * @returns {Object} `{ kind: 'command', name, argument }` or `{ kind: 'prompt', text }`
 */
export function parseLine(text) {
  const trimmed = typeof text === 'string' ? text.trim() : ''
  if (trimmed.length === 0) return { kind: 'empty' }
  const match = /^(\/[a-z]+)(?:\s+([\s\S]*))?$/.exec(trimmed)
  if (match !== null && Object.hasOwn(COMMANDS, match[1])) {
    return { kind: 'command', name: match[1], argument: (match[2] ?? '').trim() }
  }
  return { kind: 'prompt', text: trimmed }
}

/** The help text, derived from COMMANDS so the two cannot drift apart. */
export function helpText() {
  return ['Commands:', ...Object.entries(COMMANDS).map(([name, what]) => `${name} — ${what}`)].join('\n')
}

/**
 * Split a reply into chat-sized pieces.
 *
 * Chat APIs reject or truncate an over-long message, and a truncated answer is
 * worse than a split one: the reader cannot tell that the rest existed. Splits
 * prefer a blank line, then a line break, then a space, and only cut mid-word
 * when a single run of characters is longer than the limit — a code block or a
 * URL. Each piece is labelled when there is more than one, so a reader knows
 * whether they have the end.
 *
 * @param {string} text - the assistant's reply.
 * @param {number} limit - largest piece, in characters.
 * @returns {string[]} pieces in order, each within the limit including its label
 */
export function segment(text, limit = 1800) {
  const body = typeof text === 'string' ? text.trim() : ''
  if (body.length === 0) return []
  if (body.length <= limit) return [body]

  // Room for the label that every piece gets once there is more than one.
  const room = Math.max(32, limit - 12)
  const pieces = []
  let rest = body
  while (rest.length > room) {
    const window = rest.slice(0, room)
    const cut = [window.lastIndexOf('\n\n'), window.lastIndexOf('\n'), window.lastIndexOf(' ')]
      .find(index => index > room * 0.4)
    const end = cut === undefined ? room : cut
    pieces.push(rest.slice(0, end).trimEnd())
    rest = rest.slice(end).trimStart()
  }
  if (rest.length > 0) pieces.push(rest)

  return pieces.map((piece, index) => `[${index + 1}/${pieces.length}] ${piece}`)
}

/**
 * The text of an assistant message, whatever shape its content takes.
 *
 * Content is a block list; the non-text blocks (tool calls, thinking) are not
 * the answer. Returning '' for a message that carried no text is deliberate:
 * the caller then sends nothing, instead of sending an empty bubble.
 *
 * @param {Object} message - an `assistant/message` event's message.
 * @returns {string} the text blocks, joined.
 */
export function assistantText(message) {
  const content = message?.content
  if (typeof content === 'string') return content.trim()
  if (!Array.isArray(content)) return ''
  return content
    .filter(block => block?.type === 'text' && typeof block.text === 'string')
    .map(block => block.text)
    .join('\n')
    .trim()
}

/**
 * What to tell the chat when a turn produced no text.
 *
 * A turn can end having only run tools, or having been cancelled. Silence
 * would read as the bridge being broken, which is the one thing it must never
 * be mistaken for.
 *
 * @param {Object} outcome - `{ turns, tools, cancelled, error }` for the turn.
 * @returns {string} a line to send instead of nothing.
 */
export function emptyTurnNote(outcome = {}) {
  if (outcome.error !== undefined) return `The turn failed: ${outcome.error}`
  if (outcome.cancelled === true) return 'The turn was cancelled.'
  if (Number(outcome.tools) > 0) return `The turn ended after ${outcome.tools} tool call(s) without a written reply.`
  return 'The turn ended without a reply.'
}
