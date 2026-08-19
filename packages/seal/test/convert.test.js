import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CONVERTIBLE, findSoffice, isConvertible, isPdf, missingConverterMessage } from '../lib/convert.js'
import * as plugin from '../lib/index.js'

test('file types are told apart by extension', () => {
  assert.equal(isPdf('/a/contract.pdf'), true)
  assert.equal(isPdf('/a/contract.PDF'), true)
  assert.equal(isPdf('/a/contract.docx'), false)

  assert.equal(isConvertible('/a/合同.docx'), true)
  assert.equal(isConvertible('/a/合同.DOC'), true)
  assert.equal(isConvertible('/a/合同.pdf'), false, 'a PDF needs no conversion')
  assert.equal(isConvertible('/a/notes.txt'), false)
  assert.ok(CONVERTIBLE.has('.odt'))
})

test('a Word document sent to a stamp is redirected, not just rejected', () => {
  // "Not a PDF" is true and useless: the file someone wants sealed is almost
  // always a .docx, and the answer is one tool call away.
  assert.throws(() => plugin.refuseIfNotPdf('/a/合同.docx'), /seal_to_pdf/)
  assert.throws(() => plugin.refuseIfNotPdf('/a/合同.docx'), /the converted PDF, not the original/)

  // Something that is neither says so plainly rather than promising a
  // conversion that cannot happen.
  assert.throws(() => plugin.refuseIfNotPdf('/a/photo.png'), /not a document type that can be converted/)
  assert.doesNotThrow(() => plugin.refuseIfNotPdf('/a/合同.pdf'))
})

test('a missing converter is explained with the way out', async () => {
  const message = missingConverterMessage()
  assert.match(message, /LibreOffice/)
  assert.match(message, /sofficePath/)
  assert.match(message, /convert the file yourself/)
})

test('the converter is looked for where it actually lives', async () => {
  // An explicit setting wins, so a deployment with LibreOffice somewhere
  // unusual does not have to move it.
  assert.equal(await findSoffice('/definitely/not/here'), await findSoffice(undefined),
    'a configured path that does not exist falls through to the search')

  const found = await findSoffice(undefined)
  if (found !== undefined) assert.match(found, /soffice/, 'what was found should be soffice')
})
