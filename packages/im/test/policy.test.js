import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assistantText, createDedupe, emptyTurnNote, helpText, isAllowed, parseLine, segment, COMMANDS } from '../lib/policy.js'

test('an empty allowlist admits nobody', () => {
  // This is the whole security model of the bridge. A default that admitted
  // everyone would hand shell access to whoever finds the bot.
  assert.equal(isAllowed([], 'ou_abc'), false)
  assert.equal(isAllowed(undefined, 'ou_abc'), false)
  assert.equal(isAllowed(['ou_abc'], 'ou_abc'), true)
  assert.equal(isAllowed(['ou_abc'], 'ou_abcd'), false, 'no prefix matching')
  assert.equal(isAllowed(['*'], 'ou_abc'), false, 'a wildcard is not a feature here')
  assert.equal(isAllowed(['ou_abc'], ''), false, 'a platform that reports no sender is not allowed')
  assert.equal(isAllowed(['ou_abc'], undefined), false)
})

test('a redelivery is recognised once and then remembered', () => {
  const dedupe = createDedupe(3)
  assert.equal(dedupe.seen('m1'), false)
  assert.equal(dedupe.seen('m1'), true, 'the same delivery must not run the work twice')
  assert.equal(dedupe.seen(''), false, 'an id-less delivery cannot be deduped, and is not claimed to be')
})

test('the dedupe set stays bounded', () => {
  // A bridge left running for weeks must not accumulate every id it ever saw.
  const dedupe = createDedupe(3)
  for (const id of ['a', 'b', 'c', 'd']) dedupe.seen(id)
  assert.equal(dedupe.size, 3)
  assert.equal(dedupe.seen('a'), false, 'the oldest id was evicted, so it can run again')
  assert.equal(dedupe.seen('d'), true, 'the newest is still remembered')
})

test('a known command is a command; anything else is a prompt', () => {
  assert.deepEqual(parseLine('/status'), { kind: 'command', name: '/status', argument: '' })
  assert.deepEqual(parseLine('  /new  '), { kind: 'command', name: '/new', argument: '' })
  assert.deepEqual(parseLine('/help me'), { kind: 'command', name: '/help', argument: 'me' })

  // The line that would break a naive "starts with a slash" rule: a path is a
  // perfectly ordinary thing to send an agent from a phone.
  assert.deepEqual(parseLine('/usr/local/bin is on PATH?'), { kind: 'prompt', text: '/usr/local/bin is on PATH?' })
  assert.deepEqual(parseLine('/deploy now'), { kind: 'prompt', text: '/deploy now' }, 'an unknown command is not swallowed')
  assert.deepEqual(parseLine('  '), { kind: 'empty' })
  assert.deepEqual(parseLine(undefined), { kind: 'empty' })
})

test('help lists every command that exists', () => {
  const text = helpText()
  for (const name of Object.keys(COMMANDS)) assert.ok(text.includes(name), `${name} is missing from help`)
})

test('a short reply is sent as it is', () => {
  assert.deepEqual(segment('hello', 100), ['hello'])
  assert.deepEqual(segment('   ', 100), [], 'nothing to send is not an empty bubble')
})

test('a long reply is split at a break and labelled', () => {
  const paragraphs = ['first paragraph here', 'second paragraph here', 'third paragraph here'].join('\n\n')
  const pieces = segment(paragraphs, 40)

  assert.ok(pieces.length > 1)
  for (const piece of pieces) assert.ok(piece.length <= 40, `piece over the limit: ${piece.length}`)
  // The label is what tells a reader on a phone whether they have the end.
  assert.match(pieces[0], /^\[1\/\d+\] /)
  assert.match(pieces.at(-1), new RegExp(`^\\[${pieces.length}/${pieces.length}\\] `))
  // Nothing may be lost in the splitting.
  const rejoined = pieces.map(piece => piece.replace(/^\[\d+\/\d+\] /, '')).join(' ')
  for (const word of ['first', 'second', 'third']) assert.ok(rejoined.includes(word))
})

test('an unbroken run is cut rather than left over the limit', () => {
  // A base64 blob or a long URL has no space to break at, and a piece over the
  // platform's limit is rejected — which would lose the reply entirely.
  const pieces = segment('x'.repeat(300), 60)
  for (const piece of pieces) assert.ok(piece.length <= 60)
  assert.ok(pieces.length >= 5)
})

test('only text blocks are the answer', () => {
  assert.equal(assistantText({ content: 'plain' }), 'plain')
  assert.equal(assistantText({
    content: [
      { type: 'thinking', thinking: 'not for the chat' },
      { type: 'text', text: 'the answer' },
      { type: 'tool-call', name: 'bash' },
    ],
  }), 'the answer')
  assert.equal(assistantText({ content: [{ type: 'tool-call', name: 'bash' }] }), '',
    'a turn that only called tools has no text, and must not send an empty bubble')
  assert.equal(assistantText(undefined), '')
})

test('a turn with no text still says something', () => {
  // Silence would read as the bridge being broken, which is the one thing it
  // must never be mistaken for.
  assert.match(emptyTurnNote({ tools: 3 }), /3 tool call/)
  assert.match(emptyTurnNote({ cancelled: true }), /cancelled/)
  assert.match(emptyTurnNote({ error: 'no model' }), /no model/)
  assert.ok(emptyTurnNote({}).length > 0)
})
