/**
 * The signature side: a real PAdES signature over the file's bytes.
 *
 * This is the half that a dispute actually turns on. The stamp in `pdf.js`
 * renders what people expect to see; this one embeds a CMS SignedData over a
 * byte range covering the whole document, so any later edit breaks it and the
 * certificate says who signed.
 *
 * Two facts shape everything here:
 *
 *   **Order matters.** A signature covers the bytes that exist when it is made.
 *   Stamp first, then sign — stamping a signed file appends bytes the signature
 *   does not cover, and every viewer reports it as modified.
 *
 *   **A signature is only as good as the certificate.** A self-signed one is
 *   cryptographically valid and proves nothing about identity: it says the
 *   holder of that key signed, not who they are. Only a certificate from a CA
 *   the verifier trusts carries the identity claim, and this module reports
 *   which kind was used rather than letting "signed" imply "trusted".
 *
 * @module dsh-plugin-seal/sign
 */

import { P12Signer, repairEncoding } from './signer.js'
import { SignPdf } from '@signpdf/signpdf'
import { pdflibAddPlaceholder } from '@signpdf/placeholder-pdf-lib'
import { PDFDocument } from 'pdf-lib'
import forge from 'node-forge'

/**
 * Bytes reserved for the signature container.
 *
 * The placeholder has to be big enough for the CMS blob — certificate chain,
 * signed attributes and, when used, a timestamp token — because it is written
 * into a hole of fixed size. Too small fails at the last step with an opaque
 * message; the cost of too large is a few unused kilobytes.
 */
export const SIGNATURE_BYTES = 16384

/**
 * Whether a PDF already carries a signature.
 *
 * Worth knowing before signing: pdf-lib rewrites the whole file rather than
 * appending an incremental update, so adding a second signature this way
 * invalidates the first. Counter-signing by a second party needs a tool that
 * appends, and saying so beats producing a file whose first signature silently
 * reads as broken.
 *
 * @param {Uint8Array} bytes - the document.
 * @returns {boolean} whether a signature dictionary is present
 */
export function hasSignature(bytes) {
  const text = Buffer.from(bytes).toString('latin1')
  return /\/Type\s*\/Sig\b/.test(text) || /\/ByteRange\s*\[/.test(text)
}

/**
 * Sign a PDF with a PKCS#12 bundle.
 *
 * @param {Object} options - `{ pdfBytes, p12Bytes, passphrase, reason, name, location, contactInfo }`.
 * @returns {Promise<Uint8Array>} the signed document
 */
export async function signPdf({ pdfBytes, p12Bytes, passphrase, reason, name, location, contactInfo }) {
  const pdf = await PDFDocument.load(pdfBytes)

  // The placeholder is a signature dictionary with an empty /Contents of fixed
  // size and a /ByteRange that will cover everything around it.
  pdflibAddPlaceholder({
    pdfDoc: pdf,
    reason: reason ?? 'Approved',
    contactInfo: contactInfo ?? '',
    name: name ?? '',
    location: location ?? '',
    signatureLength: SIGNATURE_BYTES,
  })

  // useObjectStreams must stay off: the byte range is computed by scanning the
  // file for the placeholder, and a compressed object stream hides it.
  const withPlaceholder = await pdf.save({ useObjectStreams: false })

  let signer
  try {
    signer = new P12Signer(Buffer.from(p12Bytes), { passphrase: passphrase ?? '' })
  } catch (error) {
    throw new Error(signerFailureMessage(error))
  }

  try {
    return await new SignPdf().sign(Buffer.from(withPlaceholder), signer)
  } catch (error) {
    throw new Error(signerFailureMessage(error))
  }
}

/**
 * Turn a signing failure into something actionable.
 *
 * The wrong passphrase is the common one and its underlying message is about
 * ASN.1 parsing, which sends people looking at the wrong thing entirely.
 *
 * @param {Error} error - what the signer threw.
 * @returns {string} the message to surface
 */
export function signerFailureMessage(error) {
  const message = String(error?.message ?? error)
  if (/PKCS#12 MAC|invalid password|mac could not be verified|Invalid password/i.test(message)) {
    return 'seal: the certificate bundle did not open — check the passphrase for the .p12 file.'
  }
  if (/too small|signature exceeds|placeholder/i.test(message)) {
    return `seal: the signature did not fit the reserved space (${SIGNATURE_BYTES} bytes). A long certificate chain or a timestamp needs more room.`
  }
  if (/asn1|Cannot read|forge/i.test(message)) {
    return `seal: the certificate bundle could not be read as PKCS#12 (${message}). Export it as a .p12/.pfx containing the key and its certificate.`
  }
  return `seal: signing failed (${message})`
}

/**
 * What a signed file claims, read back from its own bytes.
 *
 * Reported so the result can state the limit precisely: a signature whose
 * certificate is self-signed is a valid signature by an unidentified party.
 *
 * @param {Uint8Array} bytes - the signed document.
 * @returns {Object} `{ signed, byteRange, coversWholeFile }`
 */
export function describeSignature(bytes) {
  const text = Buffer.from(bytes).toString('latin1')
  const range = /\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/.exec(text)
  if (range === null) return { signed: false }

  const [start, lengthOne, offsetTwo, lengthTwo] = range.slice(1).map(Number)
  return {
    signed: true,
    byteRange: [start, lengthOne, offsetTwo, lengthTwo],
    // The two covered spans must meet the ends of the file with only the
    // signature hole between them. Anything else means bytes nobody signed.
    coversWholeFile: start === 0 && offsetTwo + lengthTwo === bytes.length,
  }
}

/**
 * What the certificate in a PKCS#12 bundle claims, so the result can say what
 * the signature is worth rather than only that it exists.
 *
 * The distinction that matters: a self-signed certificate makes a
 * cryptographically valid signature by an unidentified party. Only an issuer
 * the verifier trusts turns "someone holding this key signed" into "this
 * company signed". Expiry is reported for the same reason — a signature made
 * with an expired certificate is questioned by every viewer.
 *
 * @param {Uint8Array} p12Bytes - the bundle.
 * @param {string} passphrase - its passphrase.
 * @returns {Object} `{ subject, issuer, selfSigned, notAfter, expired }`
 */
export function describeCertificate(p12Bytes, passphrase) {
  const asn1 = forge.asn1.fromDer(forge.util.createBuffer(Buffer.from(p12Bytes).toString('binary')))
  const p12 = forge.pkcs12.pkcs12FromAsn1(asn1, passphrase ?? '')
  const bags = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? []
  const found = bags.map(bag => bag.cert).find(cert => cert !== undefined)
  if (found === undefined) return { subject: '', issuer: '', selfSigned: false }
  // Same repair as the signer: forge hands back UTF8String values as raw
  // bytes, so an unrepaired name reads as mojibake in the result the user sees.
  const certificate = repairEncoding(found)

  const name = attributes => attributes.map(part => `${part.shortName ?? part.name}=${part.value}`).join(',')
  const subject = name(certificate.subject.attributes)
  const issuer = name(certificate.issuer.attributes)
  return {
    subject,
    issuer,
    selfSigned: subject === issuer,
    notAfter: certificate.validity.notAfter.toISOString().slice(0, 10),
    expired: certificate.validity.notAfter.getTime() < Date.now(),
  }
}
