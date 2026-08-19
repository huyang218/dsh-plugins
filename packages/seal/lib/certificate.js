/**
 * Issue your own signing certificate, for free, without leaving the machine.
 *
 * The certificate this produces is **self-signed**. That is a real limit and
 * not a small one: it makes a cryptographically valid signature by whoever
 * holds the key, and says nothing verifiable about who that is. What it is good
 * for is the case where both sides already know each other — an internal
 * approval, or two companies that exchange certificates once and then verify
 * every later document against them. What it is not good for is convincing a
 * stranger, or a court, on its own.
 *
 * Two free alternatives, so the choice is informed rather than defaulted into:
 * a free S/MIME certificate (Actalis and similar) carries a validated email
 * address, which is more than this; and in China the 《电子签名法》 route in
 * practice runs through an e-signature platform that signs on its own servers,
 * which is a different workflow from holding your own key.
 *
 * A Let's Encrypt certificate is NOT an option, however free: those are TLS
 * server certificates with `serverAuth` key usage, and PDF verifiers reject
 * them for document signing. People try, so it is worth naming.
 *
 * @module dsh-plugin-seal/certificate
 */

import forge from 'node-forge'

/** How long a generated certificate lasts, unless asked otherwise. */
export const DEFAULT_DAYS = 730

/**
 * Build the distinguished name a signing certificate carries.
 *
 * It is what a verifier displays as "signed by", so it should read like the
 * organisation, not like a filename.
 *
 * @param {Object} options - `{ commonName, organization, country, email }`.
 * @returns {Object[]} node-forge subject attributes
 */
export function distinguishedName({ commonName, organization, country, email }) {
  const name = String(commonName ?? '').trim()
  if (name.length === 0) throw new Error('seal: a certificate needs a common name — the person or company that signs')

  // A value with any non-ASCII character MUST be tagged UTF8. Left as the
  // default PrintableString, node-forge writes bytes that are illegal in that
  // string type, and the whole certificate becomes unparseable — openssl says
  // only "Could not find certificate". A Chinese company name is the main use
  // of this plugin, so this is the common case, not an edge one.
  const text = value => {
    const string = String(value)
    return /^[\x20-\x7e]*$/.test(string)
      ? { value: string }
      : { value: string, valueTagClass: forge.asn1.Type.UTF8 }
  }

  const attributes = [{ name: 'commonName', ...text(name) }]
  if (organization) attributes.push({ name: 'organizationName', ...text(organization) })
  if (country) {
    const code = String(country).trim().toUpperCase()
    if (!/^[A-Z]{2}$/.test(code)) throw new Error(`seal: country must be a two-letter code, not "${country}"`)
    // countryName is PrintableString by definition, and two ASCII letters fit.
    attributes.push({ name: 'countryName', value: code })
  }
  if (email) attributes.push({ name: 'emailAddress', ...text(email) })
  return attributes
}

/**
 * Generate a self-signed certificate and pack it into a PKCS#12 bundle.
 *
 * The extensions are what make a PDF reader treat it as a signing certificate
 * rather than something else: not a CA, usable for digital signatures and
 * non-repudiation, and an extended key usage that includes document signing.
 * A certificate without those is accepted by the maths and refused by the
 * readers, which is a confusing way to fail.
 *
 * @param {Object} options - `{ commonName, organization, country, email, days, passphrase, bits }`.
 * @returns {Object} `{ p12, certificatePem, subject, notAfter, fingerprint }`
 */
export function createSelfSigned({ commonName, organization, country, email, days = DEFAULT_DAYS, passphrase, bits = 2048 }) {
  if (typeof passphrase !== 'string' || passphrase.length === 0) {
    // The bundle holds a private key. Writing one to disk unprotected means
    // anyone who can read the file can sign as you, quietly.
    throw new Error('seal: a passphrase is required — the bundle holds the private key that signs as you')
  }
  if (bits < 2048) throw new Error('seal: use at least 2048-bit keys; anything smaller is refused by current verifiers')

  const attributes = distinguishedName({ commonName, organization, country, email })
  const keys = forge.pki.rsa.generateKeyPair(bits)
  const certificate = forge.pki.createCertificate()

  certificate.publicKey = keys.publicKey
  // A serial must be a positive integer; a leading 00 keeps it unsigned.
  certificate.serialNumber = `00${forge.util.bytesToHex(forge.random.getBytesSync(8))}`
  certificate.validity.notBefore = new Date()
  certificate.validity.notAfter = new Date(Date.now() + Math.max(1, days) * 24 * 60 * 60 * 1000)
  certificate.setSubject(attributes)
  // Self-signed: the issuer is the subject, which is exactly what a verifier
  // will report, and what makes this free.
  certificate.setIssuer(attributes)
  certificate.setExtensions([
    { name: 'basicConstraints', cA: false },
    { name: 'keyUsage', digitalSignature: true, nonRepudiation: true },
    {
      name: 'extKeyUsage',
      emailProtection: true,
      // Adobe's document-signing usage. Without it some readers treat the
      // certificate as unsuitable for signing rather than saying why.
      '1.3.6.1.5.5.7.3.36': true,
    },
    { name: 'subjectKeyIdentifier' },
    ...email ? [{ name: 'subjectAltName', altNames: [{ type: 1, value: String(email) }] }] : [],
  ])
  certificate.sign(keys.privateKey, forge.md.sha256.create())

  const p12Asn1 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [certificate], passphrase, {
    algorithm: '3des',
    friendlyName: String(commonName),
  })

  return {
    p12: Buffer.from(forge.asn1.toDer(p12Asn1).getBytes(), 'binary'),
    // The public half, for the other side to install so their reader trusts
    // signatures made with this key. Sharing this file is safe; sharing the
    // .p12 is not.
    certificatePem: forge.pki.certificateToPem(certificate),
    subject: attributes.map(part => `${part.name === 'commonName' ? 'CN' : part.name === 'organizationName' ? 'O' : part.name === 'countryName' ? 'C' : 'E'}=${part.value}`).join(','),
    notAfter: certificate.validity.notAfter.toISOString().slice(0, 10),
    fingerprint: forge.md.sha256.create()
      .update(forge.asn1.toDer(forge.pki.certificateToAsn1(certificate)).getBytes())
      .digest().toHex().replace(/(.{2})(?=.)/g, '$1:').toUpperCase(),
  }
}
