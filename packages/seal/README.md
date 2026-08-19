# seal

English · [中文](README.zh.md)

Put a company seal on a PDF: a **contract seal** (合同章) on chosen pages, and a
**straddle seal** (骑缝章) divided across the edge of every page, so that a page
removed, inserted or swapped leaves a gap when the pages are laid out.

> [!WARNING]
> **What gets stamped is an image, not an electronic signature.** It binds no
> identity and detects no later edit — anyone holding the file can lift the seal
> and put it on another document. A reliable electronic signature under Chinese
> law (《电子签名法》) additionally needs a CA-issued certificate binding the
> signer and a cryptographic signature over the document's bytes (PAdES).
>
> This plugin renders the seal people expect to see; a document that has to hold
> up in a dispute must also be *signed*. That paragraph is registered into the
> system prompt, so the model knows it before it can call either tool and does
> not describe stamping as signing.

The seal image is **yours** — a PNG with a transparent background. Neither tool
draws or invents a seal for an organisation.

## The two tools

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

## Install

```sh
dsh plugin --profile web add dsh-plugin-seal
```

Then point `sealPath` at your seal PNG in the plugin settings.

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

## Dependency

This package uses [pdf-lib](https://github.com/Hopding/pdf-lib) (MIT) — the only
runtime dependency in this repository. Hand-writing a PDF writer to avoid it
would put an unproven implementation between people and the documents they sign.

## Licence

MIT — see [LICENSE](LICENSE).
