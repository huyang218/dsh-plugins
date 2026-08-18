import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as plugin from '../lib/index.js'

const { extractJsonObject, normalizeEvidence } = plugin

test('a JSON object survives the wrappings models put around it', () => {
  const object = { summary: 'ok' }
  assert.deepEqual(extractJsonObject('{"summary":"ok"}'), object)
  assert.deepEqual(extractJsonObject('```json\n{"summary":"ok"}\n```'), object)
  assert.deepEqual(extractJsonObject('Sure! Here it is:\n{"summary":"ok"}\nHope that helps.'), object)
  // Braces inside strings must not end the scan early.
  assert.deepEqual(extractJsonObject('{"summary":"a } brace"}'), { summary: 'a } brace' })
})

test('text with no recoverable object returns nothing rather than a guess', () => {
  assert.equal(extractJsonObject('I cannot read this image.'), undefined)
  assert.equal(extractJsonObject('[1, 2, 3]'), undefined, 'an array is not the evidence shape')
  assert.equal(extractJsonObject('{ broken'), undefined)
  assert.equal(extractJsonObject(undefined), undefined)
})

test('a failed parse degrades to the raw answer and says that is what happened', () => {
  // The alternative — an empty evidence object — reads to the main model as
  // "the vision model saw nothing", which is a different and false claim.
  const evidence = normalizeEvidence(undefined, 'The screenshot shows a login form.')
  assert.equal(evidence.summary, 'The screenshot shows a login form.')
  assert.equal(evidence.ocr.full_text, '')
  assert.equal(evidence.uncertainty.length, 1, 'the fallback is declared, not silent')
})

test('a partial reply is filled out to the declared shape', () => {
  // A closed output schema rejects the whole call over one missing key, and
  // vision models routinely omit half the template.
  const evidence = normalizeEvidence({ summary: 'A chart.' }, 'raw')
  assert.equal(evidence.summary, 'A chart.')
  assert.deepEqual(evidence.ocr, { full_text: '', lines: [] })
  assert.deepEqual(evidence.layout, { regions: [] })
  assert.deepEqual(evidence.semantics, { scene: '', entities: [], relations: [] })
  assert.deepEqual(evidence.visual, { dominant_colors: [], style: '', notes: [] })
  assert.deepEqual(evidence.uncertainty, [])
})

test('values of the wrong type are dropped, not coerced', () => {
  // Number(null) === 0 and String(null) === 'null': a coerced field reads as
  // evidence the vision model never reported.
  const evidence = normalizeEvidence({
    summary: 42,
    ocr: { full_text: null, lines: 'not a list' },
    visual: { dominant_colors: ['#fff', 7, null], style: {}, notes: undefined },
    uncertainty: [{ nope: true }, 'blurry'],
  }, 'raw')

  assert.equal(evidence.summary, '')
  assert.equal(evidence.ocr.full_text, '')
  assert.deepEqual(evidence.ocr.lines, [])
  assert.deepEqual(evidence.visual.dominant_colors, ['#fff'])
  assert.equal(evidence.visual.style, '')
  assert.deepEqual(evidence.uncertainty, ['blurry'])
})

test('extra keys the model invents do not reach the closed schema', () => {
  const evidence = normalizeEvidence({ summary: 'x', confidence: 0.98, bbox: [0, 0, 10, 10] }, 'raw')
  assert.deepEqual(Object.keys(evidence).sort(),
    ['layout', 'ocr', 'semantics', 'summary', 'uncertainty', 'visual'])
})
