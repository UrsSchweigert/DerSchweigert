# Bundled book sources

The sixteen source EPUBs for the bundled reading library. **These files are inputs, not app content.**
They sit outside `static/`, so `scripts/copy-assets.mjs` never copies them into `www/` and they never
reach the Android bundle or the website.

`tools/epub.mjs` converts them into the canonical book JSON under `static/books/`, and
`tools/build_books.mjs --check` re-derives that JSON from these exact bytes. Committing the sources is
what makes the conversion reproducible and auditable in a sandbox that must not depend on the network.

Checksums, metadata and the public-domain basis for every file are in [`sources.json`](./sources.json).
If you replace a file, update its `sha256` and `bytes` there.

## Why these editions

Each work exists as one of two variants:

| Variant | Books | Reason |
|---|---|---|
| `.epub.noimages` | 15 | Only *Der Struwwelpeter* ships illustrations (F5.6), so the other works do not need image-bearing EPUBs. They are 0.07–0.53 MB instead of several MB each. |
| `.epub.images` | *Der Struwwelpeter* | The only illustrated book in the library: Hoffmann wrote **and** drew it (d. 1894), so the plates clear the same rights test as the text. |

Note: a `.noimages` EPUB still contains exactly **one** image — the Project Gutenberg cover. Conversion
must not ship it. Those books have `images.plates: false` in `sources.json`; only *Der Struwwelpeter*
has `true`.

## Provenance

| File | Source | Edition |
|---|---|---|
| `de-grimm-kinder-und-hausmaerchen.epub` | [Gutenberg 77905](https://www.gutenberg.org/ebooks/77905) | Deutsche Märchen, gesammelt durch die Brüder Grimm |
| `de-struwwelpeter.epub` | [Gutenberg 24571](https://www.gutenberg.org/ebooks/24571) | Der Struwwelpeter, illustrated edition |
| `de-heidi.epub` | [Gutenberg 7500](https://www.gutenberg.org/ebooks/7500) | Heidis Lehr- und Wanderjahre, 1880 |
| `de-peterchens-mondfahrt.epub` | [Gutenberg 31204](https://www.gutenberg.org/ebooks/31204) | Peterchens Mondfahrt: Ein Märchenspiel, 1912 |
| `de-biene-maja.epub` | [Gutenberg 21021](https://www.gutenberg.org/ebooks/21021) | Die Biene Maja und ihre Abenteuer, 1912 |
| `en-peter-rabbit.epub` | [Gutenberg 14838](https://www.gutenberg.org/ebooks/14838) | The Tale of Peter Rabbit, 1902 |
| `en-secret-garden.epub` | [Gutenberg 17396](https://www.gutenberg.org/ebooks/17396) | The Secret Garden, 1911 |
| `en-wind-in-the-willows.epub` | [Gutenberg 289](https://www.gutenberg.org/ebooks/289) | The Wind in the Willows, 1908 |
| `en-wizard-of-oz.epub` | [Gutenberg 55](https://www.gutenberg.org/ebooks/55) | The Wonderful Wizard of Oz, 1900 |
| `en-railway-children.epub` | [Gutenberg 1874](https://www.gutenberg.org/ebooks/1874) | The Railway Children, 1906 |
| `en-alice.epub` | [Gutenberg 11](https://www.gutenberg.org/ebooks/11) | Alice's Adventures in Wonderland, 1865 |
| `en-just-so-stories.epub` | [Gutenberg 2781](https://www.gutenberg.org/ebooks/2781) | Just So Stories, 1902 |
| `en-five-children-and-it.epub` | [Gutenberg 17314](https://www.gutenberg.org/ebooks/17314) | Five Children and It, 1902 |
| `de-heinzelmaennchen.epub` | [Wikisource](https://de.wikisource.org/wiki/Die_Heinzelm%C3%A4nnchen) | Gedicht von 1836 |
| `de-muenchhausen.epub` | [Wikisource](https://de.wikisource.org/wiki/Des_Freyherrn_von_M%C3%BCnchhausen_Wunderbare_Reisen) | Wunderbare Reisen, 1786 |
| `de-fuenfzig-fabeln.epub` | [Wikisource](https://de.wikisource.org/wiki/F%C3%BCnfzig_Fabeln_f%C3%BCr_Kinder) | Hey, Fünfzig Fabeln für Kinder, 1833 |

Gutenberg files were downloaded from `https://www.gutenberg.org/ebooks/<id>.epub.noimages` (or
`.epub.images`). Wikisource files came from the Wikimedia export service,
`https://ws-export.wmcloud.org/?lang=de&page=<page>&format=epub`.

## Two files that are not a plain export

**`de-fuenfzig-fabeln.epub`** — Wikisource's exporter does not follow subpages, so exporting the work's
main page yields only its index (~4.8 k characters). The committed EPUB was assembled from the work's
24 fable pages instead: `Rabe`, `Vogel am Fenster`, `Schneemann`, `Vögel vor der Scheuer`,
`Eichhorn und Wind`, `Knabe und Eichhorn`, `Kätzchen`, `Hund und Katze (Hey)`, `Schwan und Kind`,
`Hündchen und Böckchen`, `Möpschen und Spitzchen`, `Sperling und Pferd`, `Kind und Ochse`,
`Wandersmann und Lerche`, `Täubchen`, `Papierdrache und Vögel`, `Kanarienvogel`, `Hund und Kinder`,
`Kind und Kätzchen`, `Kind und Buch`, `Puppe und Püppchen`, `Kuchen und Brot`, `Mäuschen`,
`Hund und Igel` — fetched via the MediaWiki API in that order, with templates, categories and links
stripped, and each fable written as one `<p>` whose lines are separated by `<br/>` so the verse
structure survives into the importer. Result: 24 chapters, ~11.6 k characters.

**`de-muenchhausen.epub`** is 2.64 MB because the Wikisource export embeds twelve page scans. Only its
text is used, so the size is a source-weight cost, not app weight.

## Public-domain basis

Both cutoffs must hold, as of 2026: the author (and any translator or illustrator) died before **1956**
(EU, 70 years p.m.a.), and first publication was **1930 or earlier** (US).

The tightest cases are Waldemar Bonsels (d. 1952), Beatrix Potter (d. 1943) and Rudyard Kipling
(d. 1936); all pass, but any future addition should be checked against both rules rather than the EU
one alone. *Der Struwwelpeter* is the only entry whose illustrator is not `null` — Hoffmann (d. 1894)
drew what he wrote, which is why it is the only book allowed to ship plates.

## Sizes

16 files, 9.23 MB total. *Der Struwwelpeter* (4.09 MB) and *Münchhausen* (2.64 MB) account for most of
it. These bytes are cloned into every worker attempt and never shipped to a device.
