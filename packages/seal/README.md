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

## The three tools

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

### `seal_sign` — the PAdES signature

```
seal_sign(pdf_path, p12_path, passphrase, reason="Approved")
```

Signs the **whole file** with a CMS signature from your PKCS#12 (`.p12`/`.pfx`)
certificate. This is the part with legal weight: any later edit — including
another stamp — is detectable, and the certificate says who signed.

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
signature and certificate parsing — the only runtime dependencies in this
repository. Hand-writing a PDF writer or a CMS signer to avoid them would put
unproven code between people and the documents they sign.

## Licence

MIT — see [LICENSE](LICENSE).
