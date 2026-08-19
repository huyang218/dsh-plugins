# seal

English · [中文](README.zh.md)

Seal and sign a PDF: a **contract seal** (合同章) on chosen pages, a **straddle
seal** (骑缝章) divided across every page edge so a swapped page leaves a gap,
and a **PAdES digital signature** over the whole file from your own certificate.

> [!WARNING]
> **Stamping and signing are different things.** A stamped seal is an image: it
> binds no identity and detects no later edit — anyone holding the file can lift
> it onto another document. A reliable electronic signature under Chinese law
> (《电子签名法》) needs a certificate binding the signer and a cryptographic
> signature over the bytes, which is what `seal_sign` does.
>
> The division is clean: **the seal is for people, the signature is for
> verifiers.** That paragraph is registered into the system prompt, so the model
> knows it before it can call anything and does not describe stamping as signing.

The seal image and the certificate are **yours**. These tools neither draw a
seal nor issue a certificate for an organisation.

## The four tools

Stamping and signing are done in that order, and it is not interchangeable:
**stamp first, sign last.** A signature covers the bytes that existed when it
was made, so stamping a signed file makes every viewer report the document as
modified — stamping an already-signed file is refused for that reason.

### `seal_stamp` — the contract seal

```
seal_stamp(pdf_path, pages="last", anchor="bottom-right", width_mm=40, rotation=-8)
```

- **Pages**: `"3"`, `"1,4"`, `"2-5"`, `"all"`, `"first"`, `"last"`. A page named
  twice is stamped once — seals are semi-transparent, so a double shows.
- **Position**: a named anchor (`bottom-right`, `bottom-left`, `bottom-center`,
  `top-right`, `top-left`, `center`) with `margin_mm`, or explicit `x_mm` /
  `y_mm` from the bottom-left, like the rest of PDF space.
- **Size**: give the diameter and the other side follows the image, so a round
  seal is never squashed into an oval — a squashed seal looks forged.
- **Overflow is reported, not corrected**: a seal that lands off the page names
  the edges it crosses. Nudging it back would put the seal somewhere the signer
  did not choose.
- **Rotation** happens around the anchor, so the reported coordinate is the
  pre-rotation point; check the result when the angle is large.

### `seal_straddle` — the straddle seal

```
seal_straddle(pdf_path, edge="right", width_mm=40, pages_per_seal=20)
```

One seal is divided by the number of pages in a group, and each page carries one
slice at its edge. **Long documents are stamped in groups**: spreading one seal
over sixty pages leaves under a millimetre per page, which neither reads nor
proves anything — physical practice batches them the same way, and
`pages_per_seal` is that batch. A group that would end with a single page folds
into the one before it: a "straddle" over one page is the whole seal, which
proves nothing about any other page.

Each page draws the **whole seal** through a clip window that exposes only that
page's slice. The alternative — drawing it off the page edge and letting the
page box hide the rest — leaves the rest of the seal in the file, where it can
be extracted. That is not hidden.

### `seal_cert` — issue a certificate for free

```
seal_cert(common_name="Example Co Ltd", output_path="company.p12", passphrase="…")
```

For when there is no certificate yet: generates a key pair and a **self-signed**
certificate locally, writing the `.p12` (private key, mode `0600`) and the
`.cer` (public certificate, for the other side). No network, no purchase.

**Its limit is the point**: a self-signed certificate makes a cryptographically
valid signature that identifies nobody by itself. For the other party's reader
to accept it, they must be given the `.cer`, check the fingerprint, and choose
to trust it — which fits two sides who already know each other. For a stranger
or a court, a CA-issued certificate is still required.

What "free" actually gets you:

| Route | Free | What it proves | Verdict |
| --- | --- | --- | --- |
| `seal_cert`, self-signed | yes | someone holding that key signed; identity by prior agreement | fine internally, or between known parties |
| Free S/MIME (Actalis and similar) | yes | a validated email address | accepted by some readers, not on Adobe's AATL |
| **Let's Encrypt** | yes | **not usable for document signing** — TLS server certificates, `serverAuth` usage | ✗ a common misconception |
| Chinese e-signature platforms' free tiers | partly | third-party CA custody, the strongest 《电子签名法》 position | they sign **on their servers**, so not through this plugin |

> [!IMPORTANT]
> The `.p12` holds the private key: **anyone who has it can sign as you.** Do not
> send it to anyone and do not commit it. The file to share is the `.cer`.

### `seal_sign` — the PAdES signature

```
seal_sign(pdf_path, p12_path, passphrase, reason="Approved")
```

Signs the **whole file** with a CMS signature from your PKCS#12 (`.p12`/`.pfx`)
certificate. This is the part with legal weight: any later edit — including
another stamp — is detectable, and the certificate says who signed.

**Configure the certificate once** and later calls need only `pdf_path`:

```yaml
- id: seal
  config:
    p12Path: '/Users/you/keys/company.p12'
    passphraseEnv: 'SEAL_P12_PASSPHRASE'   # preferred: keep it out of the file
    # passphrase: '…'                      # also works, see the warning
```

The passphrase is taken from, in order: **the call, then the environment
variable named by `passphraseEnv`, then the `passphrase` setting**. A named
variable that is unset is an **error** rather than a quiet fall back to the
plaintext one — otherwise you would sign with a different credential than you
configured. The result names the source that was used, never the value.

> [!WARNING]
> A passphrase in `passphrase` is stored **in plaintext** in the profile's
> `cordis.patch.yml`, and the settings form does **not** mask it (the client
> form does not honour the `secret` role — checked, not assumed). That file gets
> backed up, synced and pasted into issues; whoever has it and the `.p12` can
> sign as you. Startup logs a warning for that route and says nothing for
> `passphraseEnv`, which keeps the secret out of the file.

- **Last, always.** Stamping a signed file appends bytes the signature does not
  cover. Stamping an already-signed document is refused, pointing back at the
  unsigned original.
- **Once.** A second signature through this path rewrites the file and
  invalidates the first. Counter-signing by another party needs a tool that
  appends an incremental update; this plugin says so rather than pretending.
- **Worth what the certificate is worth.** The result reports the subject, the
  issuer, whether it is **self-signed**, and the expiry. A self-signed
  certificate makes a cryptographically valid signature by an *unidentified*
  party — it proves someone holding that key signed, not who they are.

Don't take our word for the result: `pdfsig` (from poppler) or Adobe Reader
verify it independently.

## Install

```sh
dsh plugin --profile web add dsh-plugin-seal
```

Then point `sealPath` at your seal PNG in the plugin settings; the signing
certificate is passed per call.

## Config

| Key | Default | What it decides |
| --- | --- | --- |
| `sealPath` | *(empty)* | default seal image; empty means every call passes `seal_path` |
| `widthMm` | `40` | seal diameter (40mm is the usual Chinese company seal) |
| `opacity` | `0.9` | real ink lets the text underneath show through |
| `marginMm` | `20` | distance from the anchored edges |
| `maxPagesPerSeal` | `20` | largest group one straddle seal may span |
| `p12Path` | *(empty)* | default signing certificate; a path only, the key stays in that file |
| `passphraseEnv` | *(empty)* | environment variable holding the passphrase — the preferred route |
| `passphrase` | *(empty)* | the passphrase itself, stored in plaintext in the profile config |
| `overwrite` | `false` | whether the original may be written over |

**The original is not overwritten by default.** Stamping is irreversible, and the
unsealed original is what a dispute gets compared against; the result goes to
`<name>.sealed.pdf`.

## What it refuses

- **An encrypted PDF.** pdf-lib can open one, but writes it back without that
  protection — so a "successful" stamp would quietly strip the password. It is
  refused, with the fix named.
- **A JPEG seal** still works but is flagged: JPEG has no transparency, so the
  seal arrives as a red circle in a white box that hides the clause under it.
- **A straddle seal on a single page.** There is no seam to straddle.
- **Stamping or re-signing an already-signed file.** Either would invalidate the
  signature it already carries.

## Dependency

This package uses [pdf-lib](https://github.com/Hopding/pdf-lib) (MIT) for the
PDF work and [@signpdf](https://github.com/vbuch/node-signpdf) (MIT) with
[node-forge](https://github.com/digitalbazaar/forge) (BSD-3) for the PAdES
signature and certificates. The PKCS#12 signer is our own rather than
`@signpdf/signer-p12`: the stock one produces a signature every verifier
rejects when the certificate's name contains non-ASCII characters, which is
every Chinese company signing under its own name. See
[what that was](#a-fixed-upstream-bug) — the only runtime dependencies in this
repository. Hand-writing a PDF writer or a CMS signer to avoid them would put
unproven code between people and the documents they sign.

## A fixed upstream bug

`@signpdf/signer-p12` signs with a certificate that node-forge has parsed and
then re-encodes into the signature. That round trip is not a fixed point for a
non-ASCII distinguished name: forge returns a `UTF8String` as raw bytes and
encodes them as UTF-8 a second time. On a real certificate for
`CN=上海示例科技有限公司`, a 79-byte issuer name became 121 bytes, so the
signature named an issuer matching no certificate. `pdfsig` reported an empty
signer name and **Signature is Invalid** — a contract that looked signed and
verified as broken, for every Chinese company using its own name.

This package therefore carries its own signer, identical to the upstream one
apart from decoding those values before forge re-encodes them. There is a test
that a Chinese-named certificate signs to something `pdfsig` accepts, with the
name intact.

## Licence

MIT — see [LICENSE](LICENSE).
