# Book text extraction

`tools/epub.mjs` converts each EPUB spine document's XHTML into reading
blocks. This document specifies that conversion: every rule appears here with
a before/after example, and it is the only place segmentation is defined — the
app never re-splits text.

A document becomes a list of **blocks**, either `prose` (one paragraph:
`paragraphs`, `sentences`) or `verse` (one or more `lines`, plus `sentences`).

## Blocks

**Block elements end a paragraph.** `p`, `div`, `li`, `blockquote` and
`h1`–`h6` close the current block when they open and when they close.

```text
<p>Ein Satz.</p><p>Ein zweiter Satz.</p>
→ [{ "kind": "prose", "paragraphs": ["Ein Satz."] },
   { "kind": "prose", "paragraphs": ["Ein zweiter Satz."] }]
```

**`<br/>` and verse containers produce verse lines.** A block containing
`<br/>`, or any element whose class contains `poem`, `stanza`, `verse` or
`poetry`, becomes a `verse` block whose lines are the text around each break.

```text
<p>Der Friederich, der Friederich<br/>das war ein arger Wüterich!</p>
→ [{ "kind": "verse",
     "lines": ["Der Friederich, der Friederich", "das war ein arger Wüterich!"] }]
```

**Table cells separate words.** `td` and `th` insert a word boundary without
ending the paragraph: `<td>eins</td><td>zwei</td>` → `"eins zwei"`.

**Empty blocks are dropped.** `<p> </p><p><br/></p><p>Text</p>` yields only
`[{ "kind": "prose", "paragraphs": ["Text"] }]`.

## Entities and whitespace

**Entities and numeric references are decoded** first (`&amp;`, `&lt;`,
`&nbsp;`, `&shy;`, umlauts, typographic marks, `&#252;`, `&#xE4;`).

```text
Th&uuml;r und &#252;  →  Thür und ü
```

**`nbsp` becomes a space; soft hyphens and zero-width characters are removed
without adding one** (U+00AD, U+200B–U+200D, U+2060, U+FEFF).

```text
a&nbsp;b         →  a b
Wort&shy;bruch   →  Wortbruch
a\u200Bb         →  ab
```

**Repeated spaces and source line breaks inside a paragraph collapse to one
space:** `"  a   \n\t b  "` → `"a b"`. Only entity decoding, invisible
characters and whitespace change; no letter is ever dropped.

## Sentence splitting

Segmentation happens **only** in `tools/epub.mjs` (`splitSentences`); the app
consumes the resulting `sentences` arrays and never re-splits.

**A sentence ends after `.`, `!` or `?` plus an optional closing quote or
bracket** (`»`, `«`, `“`, `”`, `‘`, `’`, `›`, `‹`, `"`, `'`, `)`, `]`, `}`).
A period ends a sentence only when the next word starts with an uppercase
letter or a digit, or the text ends.

```text
Er rief »Hallo!« Dann ging er.  →  ["Er rief »Hallo!«", "Dann ging er."]
Er kam. dann ging er.           →  ["Er kam. dann ging er."]
```

**A period after a known title abbreviation does not end a sentence.** `Hr`,
`Fr`, `Dr`, `Mr`, `Mrs`, `Ms`, `St`, `Prof`, `Nr`, `Bd`, `etc`, `usw`, `ca`,
`bzw`, `vgl`, and the spaced forms `z. B.`, `u. a.`, `d. h.`.

```text
Dr. Hoffmann kam.  →  ["Dr. Hoffmann kam."]
z. B. ein Haus.    →  ["z. B. ein Haus."]
```

**`Herr` and `Frau` suppress a split only before a lowercase word**, because
they are also ordinary words.

```text
Herr und Frau sind da.        →  ["Herr und Frau sind da."]
Er sagte Herr. Dann ging er.  →  ["Er sagte Herr.", "Dann ging er."]
```

**A period inside a number does not end a sentence:**
`Das kostet 3.5 Euro.` → `["Das kostet 3.5 Euro."]`

**A dash-led dialogue line stays one sentence:**
`– Ja, ich weiß. Und du?` → `["– Ja, ich weiß. Und du?"]`

**Historical spelling survives unchanged.** `bey` and `Thür` pass through
byte for byte; a sentence never differs from its source excerpt except through
the rules above.

## Boilerplate removal

Boilerplate is removed only through this boundary list; every boundary is
listed here.

1. **Project Gutenberg header** — any element with `id="pg-header"`: the
   machine header and the `*** START OF … ***` separator.
2. **Project Gutenberg footer** — any element with `id="pg-footer"`: the
   `*** END OF … ***` separator and the license.
3. **`<nav>` elements** — navigation blocks are never reading text.
4. **Navigation pages** — a whole spine document is dropped only when package
   metadata marks it as a table of contents: a manifest item with
   `properties="nav"`, or a nav/NCX title of `Inhalt`, `Inhaltsverzeichnis`,
   `Contents`, `Table of Contents` or `Index`. Bodies are never inspected, so
   a chapter containing an `Inhalt` heading is still read.
5. **Printer imprints** — any element whose class contains `printer`, e.g.
   `<p class="printer">Druck von …</p>`.

`parsePackage` reports this as `navigation` per document;
`extractBlocks(xhtml, { navigation: true })` returns no blocks.

## Counts

`paragraphs` counts prose paragraphs plus verse lines; `sentences` counts
every sentence across all blocks.
