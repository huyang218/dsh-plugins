/**
 * A PKCS#12 signer that survives a non-ASCII distinguished name.
 *
 * The stock `@signpdf/signer-p12` produces a signature that every verifier
 * rejects whenever the certificate's subject contains non-ASCII characters —
 * which is to say, whenever a Chinese company signs with its own name. It is
 * not a hypothetical: an openssl-issued certificate for
 * `CN=上海示例科技有限公司` signs to `Signature is Invalid` with an empty
 * signer name in poppler's `pdfsig`.
 *
 * The cause is a round-trip that is not a fixed point. node-forge parses a
 * UTF8String attribute into a JS string holding raw UTF-8 *bytes*, then
 * re-encodes it by applying UTF-8 encoding again. The issuer name in the
 * signature's `issuerAndSerialNumber` therefore does not match the certificate
 * it names — measured on a real certificate, 79 bytes of issuer became 121 —
 * so a verifier cannot find the signing certificate and reports the signature
 * as invalid rather than as mis-encoded.
 *
 * The fix is one pass: decode those values back into real JS strings before
 * forge re-encodes them. Re-encoding then reproduces the original bytes
 * exactly. Everything else here is the upstream signer's logic, kept
 * deliberately close to it so the difference stays visible.
 *
 * @module dsh-plugin-seal/signer
 */

import forge from 'node-forge'
import { Signer } from '@signpdf/utils'

/**
 * Make a parsed certificate re-encode to the bytes it was parsed from.
 *
 * @param {Object} certificate - a forge certificate.
 * @returns {Object} the same certificate, repaired in place
 */
export function repairEncoding(certificate) {
  for (const name of [certificate.subject, certificate.issuer]) {
    for (const attribute of name?.attributes ?? []) {
      if (attribute.valueTagClass !== forge.asn1.Type.UTF8) continue
      if (typeof attribute.value !== 'string') continue
      try {
        attribute.value = forge.util.decodeUtf8(attribute.value)
      } catch {
        // Not UTF-8 after all; leaving it alone is better than corrupting a
        // name that happened to parse as something else.
      }
    }
  }
  return certificate
}

/**
 * @param {Object} name - a forge subject or issuer.
 * @returns {boolean} whether any attribute holds non-ASCII text
 */
export function hasNonAscii(name) {
  return (name?.attributes ?? []).some(attribute => typeof attribute.value === 'string'
    && !/^[\x20-\x7e]*$/.test(attribute.value))
}

/** Signs with a PKCS#12 bundle, repairing names on the way through. */
export class P12Signer extends Signer {
  /**
   * @param {Buffer} p12Buffer - the bundle.
   * @param {Object} options - `{ passphrase, asn1StrictParsing }`.
   */
  constructor(p12Buffer, options = {}) {
    super()
    this.options = { asn1StrictParsing: false, passphrase: '', ...options }
    this.p12 = forge.util.createBuffer(Buffer.from(p12Buffer).toString('binary'))
  }

  /**
   * Produce the detached CMS signature over a PDF's signed bytes.
   * @param {Buffer} pdfBuffer - the bytes covered by the signature.
   * @param {Date} [signingTime] - recorded in the signed attributes.
   * @returns {Promise<Buffer>} the DER-encoded signature
   */
  async sign(pdfBuffer, signingTime = undefined) {
    const p12 = forge.pkcs12.pkcs12FromAsn1(
      forge.asn1.fromDer(this.p12),
      this.options.asn1StrictParsing,
      this.options.passphrase,
    )

    const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? []
    const keyBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] ?? []
    const privateKey = keyBags[0]?.key
    if (privateKey === undefined) {
      throw new Error('seal: the bundle holds no private key — export the .p12 with the key, not just the certificate')
    }

    const p7 = forge.pkcs7.createSignedData()
    p7.content = forge.util.createBuffer(pdfBuffer.toString('binary'))

    let certificate
    for (const bag of certBags) {
      // The repair happens before the certificate reaches the CMS, so both the
      // embedded copy and the issuer reference are the original bytes.
      const cert = repairEncoding(bag.cert)
      p7.addCertificate(cert)
      if (privateKey.n.compareTo(cert.publicKey.n) === 0 && privateKey.e.compareTo(cert.publicKey.e) === 0) {
        certificate = cert
      }
    }
    if (certificate === undefined) {
      throw new Error('seal: no certificate in the bundle matches its private key')
    }

    // The attribute order matters for EU signature validation, so it follows
    // the upstream signer exactly.
    p7.addSigner({
      key: privateKey,
      certificate,
      digestAlgorithm: forge.pki.oids.sha256,
      authenticatedAttributes: [
        { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
        { type: forge.pki.oids.signingTime, value: signingTime ?? new Date() },
        { type: forge.pki.oids.messageDigest },
      ],
    })

    p7.sign({ detached: true })
    return Buffer.from(forge.asn1.toDer(p7.toAsn1()).getBytes(), 'binary')
  }
}
