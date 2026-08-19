import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PDFDocument } from 'pdf-lib'
import { describeCertificate, describeSignature, hasSignature, signPdf, signerFailureMessage } from '../lib/sign.js'

/** @returns {boolean} whether a command exists on this machine */
function available(command) {
  try {
    execFileSync('which', [command], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

const workspace = mkdtempSync(join(tmpdir(), 'seal-sign-'))
const hasOpenssl = available('openssl')

/**
 * A self-signed PKCS#12, made here rather than committed: a private key in a
 * repository is a private key on the internet, even a throwaway one.
 * @param {string} passphrase - the bundle's passphrase.
 * @returns {Uint8Array} the bundle
 */
function testP12(passphrase = 'secret') {
  const key = join(workspace, 'key.pem')
  const cert = join(workspace, 'cert.pem')
  const p12 = join(workspace, `bundle-${passphrase}.p12`)
  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-keyout', key, '-out', cert,
    '-days', '365', '-nodes', '-subj', '/CN=seal test signer/O=Test Only/C=CN',
  ], { stdio: 'ignore' })
  execFileSync('openssl', [
    'pkcs12', '-export', '-out', p12, '-inkey', key, '-in', cert, '-passout', `pass:${passphrase}`,
  ], { stdio: 'ignore' })
  return readFileSync(p12)
}

/** @returns {Promise<Uint8Array>} a two-page PDF */
async function samplePdf() {
  const pdf = await PDFDocument.create()
  pdf.addPage([595.28, 841.89])
  pdf.addPage([595.28, 841.89])
  return pdf.save()
}

test('an unsigned document is recognised as unsigned', async () => {
  assert.equal(hasSignature(await samplePdf()), false)
  assert.deepEqual(describeSignature(await samplePdf()), { signed: false })
})

test('a wrong passphrase is explained as a passphrase problem', () => {
  // Its underlying message is about ASN.1 parsing, which sends people looking
  // at the certificate file instead of what they typed.
  assert.match(
    signerFailureMessage(new Error('PKCS#12 MAC could not be verified. Invalid password?')),
    /check the passphrase/,
  )
  assert.match(signerFailureMessage(new Error('asn1 bad tag')), /PKCS#12/)
  assert.match(signerFailureMessage(new Error('weird')), /signing failed \(weird\)/)
})

test('signing covers the whole file, and says whose certificate did it', { skip: !hasOpenssl && 'openssl not installed' }, async () => {
  const p12 = testP12()
  const signed = await signPdf({
    pdfBytes: await samplePdf(),
    p12Bytes: p12,
    passphrase: 'secret',
    reason: 'Approved',
    name: 'Test Signer',
  })

  const described = describeSignature(signed)
  assert.equal(described.signed, true)
  // Two spans meeting the ends of the file with only the signature hole
  // between them. Anything else means bytes nobody signed.
  assert.equal(described.coversWholeFile, true)
  assert.equal(described.byteRange[0], 0)

  const certificate = describeCertificate(p12, 'secret')
  assert.match(certificate.subject, /seal test signer/)
  assert.equal(certificate.selfSigned, true, 'a self-signed certificate must be reported as such')
  assert.equal(certificate.expired, false)
})

test('the wrong passphrase fails rather than producing an unsigned file', { skip: !hasOpenssl && 'openssl not installed' }, async () => {
  await assert.rejects(
    signPdf({ pdfBytes: await samplePdf(), p12Bytes: testP12(), passphrase: 'wrong' }),
    /passphrase|PKCS#12/,
  )
})

test('an independent verifier accepts the signature and rejects a tampered copy', {
  skip: !hasOpenssl ? 'openssl not installed' : !available('pdfsig') && 'pdfsig (poppler) not installed',
}, async () => {
  // The whole point of this feature is that someone else's tool agrees. Our own
  // assertions about our own output cannot establish that.
  const signed = await signPdf({
    pdfBytes: await samplePdf(),
    p12Bytes: testP12(),
    passphrase: 'secret',
    reason: 'Approved',
  })
  const path = join(workspace, 'signed.pdf')
  writeFileSync(path, signed)

  // pdfsig exits non-zero for an invalid signature, which is correct of it and
  // would otherwise throw here before the assertion could read the verdict.
  const verify = file => {
    try {
      return execFileSync('pdfsig', [file], { encoding: 'utf8' })
    } catch (error) {
      return String(error.stdout ?? '') + String(error.stderr ?? '')
    }
  }

  const report = verify(path)
  assert.match(report, /Signature is Valid/)
  assert.match(report, /Total document signed/)
  // A self-signed certificate is untrusted, which is exactly what the plugin
  // reports back rather than calling the document verified.
  assert.match(report, /isn't Trusted|is Trusted/)

  const tampered = Buffer.from(signed)
  tampered[500] ^= 0x01
  const tamperedPath = join(workspace, 'tampered.pdf')
  writeFileSync(tamperedPath, tampered)

  const after = verify(tamperedPath)
  assert.doesNotMatch(after, /Signature is Valid/, 'an edited byte must break the signature')
  assert.match(after, /Digest Mismatch|Signature is Invalid/)
})

test('a signed file is recognised, so it is not signed twice', { skip: !hasOpenssl && 'openssl not installed' }, async () => {
  // A second signature through this path rewrites the file and the first one
  // then reads as broken to every viewer.
  const signed = await signPdf({ pdfBytes: await samplePdf(), p12Bytes: testP12(), passphrase: 'secret' })
  assert.equal(hasSignature(signed), true)
})
