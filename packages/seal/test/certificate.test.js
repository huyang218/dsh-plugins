import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import forge from 'node-forge'
import { PDFDocument } from 'pdf-lib'
import { createSelfSigned, distinguishedName } from '../lib/certificate.js'
import { describeCertificate, signPdf } from '../lib/sign.js'
import { hasNonAscii, repairEncoding } from '../lib/signer.js'

const workspace = mkdtempSync(join(tmpdir(), 'seal-cert-'))

/** @returns {boolean} whether a command exists here */
function available(command) {
  try {
    execFileSync('which', [command], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

test('a certificate needs a name and a passphrase', () => {
  assert.throws(() => distinguishedName({}), /needs a common name/)
  assert.throws(() => createSelfSigned({ commonName: 'X' }), /passphrase is required/)
  // The bundle holds a private key; unprotected on disk means anyone who can
  // read the file can sign as you.
  assert.throws(() => createSelfSigned({ commonName: 'X', passphrase: '' }), /passphrase is required/)
  assert.throws(() => createSelfSigned({ commonName: 'X', passphrase: 'p', bits: 1024 }), /2048/)
  assert.throws(() => distinguishedName({ commonName: 'X', country: 'CHN' }), /two-letter code/)
})

test('a non-ASCII name is tagged UTF8, an ASCII one is left alone', () => {
  // Left as the default PrintableString, the bytes are illegal for that string
  // type and the whole certificate becomes unparseable.
  const chinese = distinguishedName({ commonName: '上海示例科技有限公司' })
  assert.equal(chinese[0].valueTagClass, forge.asn1.Type.UTF8)

  const ascii = distinguishedName({ commonName: 'Example Co', country: 'cn' })
  assert.equal(ascii[0].valueTagClass, undefined)
  assert.equal(ascii[1].value, 'CN', 'the country code is upper-cased and stays PrintableString')
})

test('a generated certificate is self-signed and says so', () => {
  const made = createSelfSigned({ commonName: 'Example Co', organization: 'Example', country: 'CN', passphrase: 'p', days: 30 })
  assert.match(made.subject, /CN=Example Co/)
  assert.match(made.certificatePem, /^-----BEGIN CERTIFICATE-----/)
  assert.match(made.fingerprint, /^[0-9A-F]{2}(:[0-9A-F]{2})+$/)

  const described = describeCertificate(made.p12, 'p')
  assert.equal(described.selfSigned, true)
  assert.equal(described.subject, described.issuer)
  assert.equal(described.expired, false)
})

test('a Chinese name survives the round trip into the bundle', () => {
  // forge hands UTF8String values back as raw bytes; unrepaired they read as
  // mojibake in the result the user is shown.
  const made = createSelfSigned({ commonName: '上海示例科技有限公司', organization: '示例科技', country: 'CN', passphrase: 'p' })
  assert.equal(describeCertificate(made.p12, 'p').subject, 'CN=上海示例科技有限公司,O=示例科技,C=CN')
})

test('repairing a parsed name makes forge re-encode it to the original bytes', () => {
  // This is the whole bug in one assertion: without the repair, a certificate's
  // issuer re-encodes to different bytes, the signature names an issuer that
  // matches no certificate, and every verifier calls it invalid.
  const made = createSelfSigned({ commonName: '上海示例科技有限公司', passphrase: 'p' })
  const certificate = forge.pki.certificateFromPem(made.certificatePem)
  const original = forge.asn1.toDer(
    forge.asn1.fromDer(forge.util.createBuffer(forge.pki.pemToDer(made.certificatePem).getBytes())).value[0].value[3],
  ).getBytes()

  const broken = forge.asn1.toDer(forge.pki.distinguishedNameToAsn1(certificate.issuer)).getBytes()
  assert.notEqual(broken, original, 'the unrepaired round trip is expected to differ')

  repairEncoding(certificate)
  const repaired = forge.asn1.toDer(forge.pki.distinguishedNameToAsn1(certificate.issuer)).getBytes()
  assert.equal(repaired, original)
})

test('non-ASCII names are recognised as the case needing repair', () => {
  assert.equal(hasNonAscii({ attributes: [{ value: 'Example Co' }] }), false)
  assert.equal(hasNonAscii({ attributes: [{ value: '示例' }] }), true)
  assert.equal(hasNonAscii(undefined), false)
})

test('a Chinese-named certificate produces a signature an outside verifier accepts', {
  skip: !available('pdfsig') && 'pdfsig (poppler) not installed',
}, async () => {
  // The regression this guards: with the stock signer this exact case produced
  // "Signature is Invalid" and an empty signer name — a broken contract that
  // looked signed.
  const pdf = await PDFDocument.create()
  pdf.addPage([595.28, 841.89])
  const made = createSelfSigned({ commonName: '上海示例科技有限公司', organization: '示例科技', country: 'CN', passphrase: 'p' })
  const signed = await signPdf({ pdfBytes: await pdf.save(), p12Bytes: made.p12, passphrase: 'p' })

  const path = join(workspace, 'cjk-signed.pdf')
  writeFileSync(path, signed)
  const report = execFileSync('pdfsig', [path], { encoding: 'utf8' })

  assert.match(report, /Signature is Valid/)
  assert.match(report, /Total document signed/)
  assert.match(report, /上海示例科技有限公司/, 'the signer name has to survive into what a verifier displays')
})
