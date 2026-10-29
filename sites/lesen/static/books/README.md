# Book text extraction

`tools/epub.mjs` converts each EPUB spine document's XHTML into reading
blocks. This document is the specification of that conversion. Every rule is
listed here with a before/after example, and it is the only place the
segmentation rules are defined — the app never re-splits text.

A document becomes a list of **blocks**. Each block is either:

- `prose` — one paragraph (`paragraphs`, `sentences`), or
- `verse` — one or more verse lines (`lines`, `sentences`).

Both kinds carry a `sentences` array.

## Block rules

**Block elements end a paragraph.** `p`, `div`, `li`, `blockquote` and
`h1`–`h6` close the current block when they open and when they close.

```html
<p>Ein Satz.</p><p>Ein zweiter Satz.</p>
```
```json
[{ "kind": "prose", "paragraphs": ["Ein Satz."] },
 { "kind": "prose", "paragraphs": ["Ein zweiter Satz."] }]
```

**`<br/>` produces verse lines.** A block that contains a `<br/>` becomes a
`verse` block whose lines are the text around each break.

```html
<p>Der Friederich, der Friederich<br/>
das war ein arger Wüterich!</p>
```
```json
[{ "kind": "verse",
   "lines": ["Der Friederich, der Friederich", "das war ein arger Wüterich!"] }]
```

**Verse containers produce verse lines.** Elements whose class contains
`poem`, `stanza`, `verse` or `poetry` mark their content as verse even when no
`<br/>` is present.

```html
<div class="poem"><div class="stanza">Zeile eins</div></div>
```
```json
[{ "kind": "verse", "lines": ["Zeile eins"] }]
```

**Empty blocks are dropped.** A paragraph with no visible text, or a verse
block with no non-empty lines, produces no block at all.

```html
<p> </p><p><br/></p><p>Text</p>
```
```json
[{ "kind": "prose", "paragraphs": ["Text"] }]
```

## Entities and whitespace

**Entities and numeric references are decoded** before any other step. Named
entities include `&amp;`, `&lt;`, `&gt;`, `&quot;`, `&apos;`, `&nbsp;`,
`&shy;`, the German umlauts and common typographic marks; numeric references
(`&#252;`, `&#xE4;`) are decoded as well.

| Before         | After |
| -------------- | ----- |
| `Th&uuml;r`    | `Thür` |
| `&#252; &#xE4;` | `ü ä`  |

**`nbsp` collapses to a space.** A non-breaking space is whitespace, not a
letter.

| Before     | After |
| ---------- | ----- |
| `a&nbsp;b` | `a b` |

**Soft hyphens are removed** without adding a space, so the surrounding
letters stay together.

| Before          | After      |
| --------------- | ---------- |
| `Wort&shy;bruch` | `Wortbruch` |

**Zero-width spaces (U+200B) and other invisible characters are removed.**
Soft hyphen (U+00AD), zero-width space (U+200B), zero-width non-joiner/joiner
(U+200C/U+200D), word joiner (U+2060) and the byte-order mark (U+FEFF) carry
no letter and are stripped.

| Before     | After |
| ---------- | ----- |
| `a\u200Bb` | `ab`  |

**Repeated spaces and line breaks inside a paragraph collapse to one space.**
Source line breaks are pretty-printing only and never become verse lines.

| Before              | After |
| ------------------- | ----- |
| `  a   ` `\n\t` ` b  ` | `a b` |

No letter is ever dropped by these rules: only entity decoding, invisible
characters and whitespace change.

## Sentence splitting

Sentence segmentation happens **only** in `tools/epub.mjs`
(`splitSentences`). The app consumes the resulting `sentences` arrays and
never re-splits.

**A sentence ends after `.`, `!` or `?` plus an optional closing quote or
bracket** (`»`, `«`, `“`, `”`, `‘`, `’`, `›`, `‹`, `"`, `'`, `)`, `]`, `}`).

```text
Er rief »Hallo!« Dann ging er.
```
```json
["Er rief »Hallo!«", "Dann ging er."]
```

**A period after a known abbreviation does not end a sentence.** The
recognised abbreviations are `Herr`, `Hr`, `Frau`, `Fr`, `Dr`, `Mr`, `Mrs`,
`Ms`, `St`, `Prof`, `Nr`, `Bd`, `etc`, `usw`, `ca`, `bzw`, `vgl`, and the
spaced forms `z. B.`, `u. a.`, `d. h.` and similar.

```text
Dr. Hoffmann kam. z. B. ein Haus. u. a. auch.
```
```json
["Dr. Hoffmann kam.", "z. B. ein Haus.", "u. a. auch."]
```

**A period inside a number does not end a sentence.**

```text
Das kostet 3.5 Euro.
```
```json
["Das kostet 3.5 Euro."]
```

**A dash-led dialogue line stays one sentence.** Text that begins with an em
dash (`—`) or en dash (`–`) is a single utterance and is not split further.

```text
– Ja, ich weiß. Und du?
```
```json
["– Ja, ich weiß. Und du?"]
```

**Historical spelling survives unchanged.** Characters such as `bey` and
`Thür` pass through byte-for-byte; a sentence never differs from its source
excerpt except through the rules above.

## Boilerplate removal

Boilerplate is removed by this explicit boundary list; every boundary is
listed here.

1. **Project Gutenberg header** — the `<div id="pg-header">` element and all
   of its content (the machine header and the
   `*** START OF THE PROJECT GUTENBERG EBOOK … ***` separator).

2. **Project Gutenberg footer** — the `<div id="pg-footer">` element and all
   of its content (the `*** END OF THE PROJECT GUTENBERG EBOOK … ***`
   separator and the full license).

3. **`<nav>` elements** — navigation blocks are never reading text.

4. **Navigation pages** — a whole document is dropped when any of its
   `h1`–`h6` headings is a table of contents: `Inhalt`,
   `Inhaltsverzeichnis`, `Contents`, `Table of Contents` or `Index`.

5. **Printer imprints** — any element whose class contains `printer` (for
   example `<p class="printer">Druck von …</p>`) is dropped.

## Counts

`extractBlocks` returns `{ blocks, paragraphs, sentences }` where:

- `paragraphs` counts prose paragraphs plus verse lines (the total number of
  text segments), and
- `sentences` counts every sentence across all blocks.

These are the values the manifest stores and the tests assert.
