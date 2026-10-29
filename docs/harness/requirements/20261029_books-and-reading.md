# Buchstabenzeit: reading whole sentences with public-domain books

Status: draft for owner approval
Date: 2026-10-29
Applies to: `lesen.derschweigert.de` (web) and the Capacitor Android package in `sites/lesen/android`
Source of truth: `sites/lesen/static/` (copied verbatim into the Android bundle by `sites/lesen/scripts/copy-assets.mjs`)

Requirements below extend the existing card app with (a) a merged letter-pattern mode, (b) a
sentence-reading mode built on sixteen public-domain books — eight German and eight English — including
per-book readability percentages, paragraph context, adult/child word roles and sentences usable as
cards. Books are converted from EPUB at build time into a lean offline format; there is no book
import in the app itself.

---

## 1. How to read this document

* Every requirement is a row `| **ID** | **Title** | P | description |`. The harness extracts IDs and
  titles from these rows; **do not renumber them after approval.**
* `F1` patterns, `F2` books and coverage, `F3` sentence reader, `F4` sentence cards,
  `F5` EPUB ingestion and licensing, `F6` cross-cutting. `F4.3` and `F4.4` are the only P2 items.
* **P** = priority: `P1` must ship, `P2` should ship, `P3` may follow.
* Section 4 gives acceptance criteria per requirement. Section 5 lists the sixteen books with measured
  readability. Section 6 defines the percentage metric exactly. Sections 9–12 list owner decisions,
  non-goals, validation and risks.

## 1.1 Decisions already made — do not ask again

These were settled with the owner on 2026-10-29. Treat them as fixed inputs, not as questions.

| # | Question | Decision |
|---|---|---|
| D1 | Where do the sixteen source EPUBs come from? | **Committed.** `sites/lesen/books-src/` holds all sixteen, 9.23 MB, merged as `01c9cb3` (PR #45), with `sources.json` (per-file `sha256`, `bytes`, PD basis, `images.plates`) and a provenance README. Fifteen are the Gutenberg `.noimages` EPUB; *Der Struwwelpeter* is the illustrated `.epub.images`. Nothing is fetched by a worker, ever. |
| D2 | What must `build_books.mjs --check` do when sources are absent? | **Require them.** Exit non-zero, naming `sites/lesen/books-src/` and the expected count of 16, when the directory is missing or a checksum mismatches. Otherwise re-convert all sixteen with `tools/epub.mjs` and fail on any byte difference against `static/books/**`. A skipped re-conversion never counts as a pass. |
| D3 | How is `--check` tested and where does it run? | `--check` takes `--sources` (default `sites/lesen/books-src`) so the missing-source path is testable against an empty temp dir. Enforce it from inside `sites/lesen/tests/` (spawn it, assert exit 0; second test asserts non-zero when `--sources` is empty) so the existing CI step `node --test sites/lesen/tests/*.test.mjs` in `.github/workflows/deploy.yml` covers it with no workflow change. Budget: full re-conversion under ~5 s in the worker. |
| D4 | Do bundled books ship complete or as curated excerpts? | **Complete.** No excerpting and no human curation in this drop. The numbers in §5.3/§5.4 are measured on whole works, so they now apply directly. Excerpting stays a later editorial pass (§5.6). |
| D5 | Is there runtime book import? | **No.** The importer is a build-time tool. No `DecompressionStream`, no ZIP code and no WebView capability check ships. DEFLATE is injected into `tools/epub.mjs` (the build passes Node `zlib.inflateRawSync`). |
| D6 | Which books? | Eight German and eight English, exactly as listed in §5.3/§5.4. *Der Struwwelpeter* ships with its plates and its content note. |
| D7 | Book picker or a fifth pattern radio? | A **tab**: "Karten" (existing screen, unchanged) and "Geschichten" (new). |
| D8 | Default sentence filter? | At most **2** adult words per sentence; ordering by difficulty available. |
| D9 | What does the child do? | Reads **aloud**; the adult marks. No typing, writing or spelling input anywhere. |
| D10 | What does the percentage mean? | Share of running **tokens** is primary, share of distinct **types** is secondary. Round, prefix with ≈, label "theoretisch". `S3` (all sounds) must be exactly 100.0 % — that is the metric's sanity anchor. |
| D11 | May phases set `working_directory`? | **Yes, and use `sites/lesen`.** The lesen smoke rule now passes an absolute repository root (`node /opt/harness/smoke/lesen.mjs /work`), so a working directory no longer breaks it. Do not "fix" a failing smoke check by changing `working_directory`. |
| D12 | Which model source runs the plan? | `deepseek` only, through a BYOK provider profile. `low` and `standard` both map to `deepseek-flash`; `strong` is `deepseek-v4-pro`. Only one real upgrade exists, and `strong_attempts_per_issue` is 1, so prefer `strong` for issues on escalation paths and keep `deepseek-flash` for bounded work. |
| D13 | May a worker write or fetch book text? | **No.** §5.5 still applies: no hand-written, abridged or modernised text, and no network fetch. Text comes only from the committed EPUBs via the importer. |
| D14 | Scope of cards and bookmarks? | F4.1/F4.2 and F3.7 are in. F4.3 and F4.4 remain the only P2 items. |
| D15 | Who writes alt text for the 32 plates, now that curation is gone? | **Nobody during this plan.** Alt text must be non-empty, accurate and free of file names; for this drop it is generated deterministically from the plate's chapter title and its index within that chapter (for example "Der Struwwelpeter, Bild 2 zu ›Die Geschichte vom Daumenlutscher‹"). That is truthful, useful to a screen reader and invents nothing. Replacing it with descriptive prose is a later editorial pass, like excerpting. |
| D16 | How is a cancelled plan restarted? | **Not** by minting a new version of the same plan id. `harness cancel` writes `cancel_requested` into the run record, which is keyed by plan id and not by plan version, and `Scheduler.__init__` deliberately preserves it; the first tick of any later version of that id then cancels that version too. `plan` cannot mint a version either while the content is unchanged (`unchanged: true` returns the existing version). The restart is therefore: amend this document so the digest changes, let `plan` create the next version, approve it, and cancel the obsolete issues left over from the earlier draft. A `harness uncancel` command and a version-scoped cancel flag are follow-ups, not part of this plan. |

**Consequence for the content phase:** with D1 and D4 together, the conversion is fully autonomous — the
importer reads committed bytes and the committed JSON is re-derived by `--check`, with no human input
and no network. Nothing in this plan may block on editorial curation.

## 2. Current state (verified 2026-10-29)

| Area | Today |
|---|---|
| Modes | Four radios named `pattern`: `CV` ("ma"), `VC` ("am"), `WORDS`, `FLOP` in [index.html](../sites/lesen/static/index.html) |
| Sound model | [sounds.mjs](../sites/lesen/static/sounds.mjs): `tokenizeWord`, `countMatchingWords`, `isSpellableWith`-equivalent logic; German specials `ä ö ü au ei ie eu sch ch st ai xx`, English `sh ch th oo ee ai ou` |
| Cards | `{ text, misses }`; the practice screen shows one card, the adult marks "Richtig gelesen" or retries |
| Statistics | [scoring.mjs](../sites/lesen/static/scoring.mjs) `recordAttempt(stats, card.text, correct, { flop })`; [storage.mjs](../sites/lesen/static/storage.mjs) persists a flat map under `buchstabenzeit:card-stats` |
| Flops | `selectFlopDeck` (worst 10 %, min 1, max 30) over `flopCandidateCards`, which filters statistics keys by `isSpellableWith` |
| Vocabulary | `static/words-de.json` (CC BY-SA 4.0, English-origin words deliberately removed) and `static/words-en.json` (CC BY 4.0); built by `sites/lesen/tools/build_wordlist*.py` |
| i18n | [i18n.mjs](../sites/lesen/static/i18n.mjs); `tests/i18n.test.mjs` enforces identical DE/EN keys and that every `tr('…')` key in `index.html` exists in German |
| Audio | [speech-adapter.js](../sites/lesen/static/speech-adapter.js) (`speak({ text, lang, rate, onUnsupported, onNoVoice, onError })`), offline voice filter, one-time TTS disclaimer |
| Android | `copy-assets.mjs` copies the whole `static/` tree into `www/`; no build-file change is needed for new static files |

## 3. Requirements

### 3.1 Letter patterns (F1) — the "am"/"ma" side note

| ID | Title | P | Description |
|---|---|---|---|
| **F1.1** | **Merge "ma" and "am" into one Patterns mode** | P1 | Replace the two pattern radios `CV` and `VC` with one radio "Muster" that offers the sub-patterns `ma`, `am`, `mam`, `ama` as an inline multi-selection; `ma` and `am` are pre-selected so today's default behaviour is preserved. |
| **F1.2** | **Generate decks from every selected sub-pattern** | P1 | Build one deck from all checked sub-patterns (`ma` = CV, `am` = VC, `mam` = CVC, `ama` = VCV) with identical card text de-duplicated, honouring the requested card count, and block starting with a clear message when nothing is checked. |
| **F1.3** | **Patterns strings and regression coverage** | P1 | Add German and English strings for the merged mode and its four sub-patterns, keep Words and Flops behaviour unchanged, and cover the new deck builder and empty selection with tests. |

### 3.2 Books and readability percentages (F2)

| ID | Title | P | Description |
|---|---|---|---|
| **F2.1** | **Bundle sixteen public-domain books offline** | P1 | Ship eight German and eight English curated books as static JSON with a manifest, usable with no network, account or backend on web and Android. |
| **F2.2** | **Show the readability percentage per book** | P1 | For every book, show the share of running text (primary) and of distinct words (secondary) that the child can decode with the currently selected letters and specials, recomputed live when the selection changes. |
| **F2.3** | **Book picker with coverage, difficulty and progress** | P1 | Add a "Geschichten" area on the setup screen that lists the books of the selected language with title, author, coverage, average adult words per sentence and reading position, sorted by readability. |
| **F2.4** | **Explain what the percentage means and what is missing** | P1 | Label the percentage as theoretical, state that it counts words, not understanding, and name the most frequent words the adult will have to read plus the sounds that would raise coverage most. |
| **F2.5** | **Coverage caching and performance budget** | P1 | Cache coverage per book and selection, compute the whole library without blocking first paint, and stay inside the stated time budget on a mid-range Android device. |

### 3.3 Sentence reader (F3)

| ID | Title | P | Description |
|---|---|---|---|
| **F3.1** | **Read sentence by sentence inside paragraph context** | P1 | Present a book one sentence at a time while keeping the complete current paragraph visible (previous and next sentences dimmed, paragraph and verse line breaks preserved), so the child never reads a sentence without its context. |
| **F3.2** | **Mark which words the child reads and which the adult reads** | P1 | Classify every word of the current sentence as child-readable or adult-read from the current selection, and mark both roles visibly and non-colour-only, with a legend the child can understand. |
| **F3.3** | **Adult support for words with unknown letters** | P1 | On tapping an adult word, the adult can hear it read aloud and see which sounds the child is missing; read-aloud is optional, offline-only and never starts by itself. |
| **F3.4** | **Navigate, resume and track progress** | P1 | Move to the next/previous sentence and paragraph, resume a book at the last read sentence, and show position within the book on the reader screen. |
| **F3.5** | **Filter and order sentences by adult-word count** | P1 | Let the adult restrict a reading session to sentences with at most N adult words (default 2) and order the session by difficulty, because whole books contain many sentences a beginner cannot read at all. |
| **F3.6** | **Show the illustration of an excerpt** | P1 | For illustrated books, show the plate that belongs to the excerpt above the paragraph, with alt text and without pushing the sentence off screen; books without plates render exactly as before. |
| **F3.7** | **Bookmark the current sentence and return to it later** | P1 | Let the reader mark the current sentence and later jump straight back to it from a list, with the mark visible in the paragraph and persisted on the device; explicit bookmarks are separate from automatic resume. |

### 3.4 Sentences as cards (F4)

| ID | Title | P | Description |
|---|---|---|---|
| **F4.1** | **Send a sentence to practice as a card** | P1 | From the reader, add the current sentence to the card practice flow, where the adult marks it "Richtig gelesen" or retries exactly like a word card. |
| **F4.2** | **Stable card identity and statistics schema v2** | P1 | Key statistics by a card id instead of the display text, migrate existing counters without loss, and keep Flops working for word cards. |
| **F4.3** | **Sentence cards participate in Flops** | P2 | Include sentence cards whose language matches the current session in Flop Training, independent of the current letter selection. |
| **F4.4** | **Sentence decks alongside word decks** | P2 | Offer a practice deck made of collected sentences, and allow a deck that mixes the current letter cards with collected sentences. |

### 3.5 Content pipeline and licensing (F5)

| ID | Title | P | Description |
|---|---|---|---|
| **F5.1** | **One EPUB ingestion module, used at build time** | P1 | Parse EPUB 2 and EPUB 3 offline in the build (ZIP container, `container.xml`, package document, spine, manifest) into the canonical book model, with the DEFLATE step injected so the module carries no decompressor. |
| **F5.2** | **Canonical book model and build-time conversion** | P1 | Store each book as paragraphs of precomputed sentences with stable ids, prose/verse markers and image references; the bundled books are produced by running the shared importer, never by hand-editing text. |
| **F5.3** | **Public-domain gate for bundled books** | P1 | Refuse to ship a bundled book unless its recorded author, death year, first publication year, translator and illustrator pass the EU and US public-domain rules. |
| **F5.4** | **In-app book credits** | P1 | List every shipped book, its author, illustrator, year, source and public-domain basis in the existing about/legal dialog, in both languages. |
| **F5.5** | **Extraction rules are explicit and lossless** | P1 | HTML is reduced to text by documented rules that preserve wording, spelling, punctuation and paragraph/verse structure; nothing is rewritten, modernized or abridged. |
| **F5.6** | **Illustrations come from the book itself** | P1 | Take plates from the EPUB's own image manifest, only where the illustrator's rights pass the same test, with checksum and accurate non-empty alt text. |

### 3.6 Cross-cutting (F6)

| ID | Title | P | Description |
|---|---|---|---|
| **F6.1** | **Offline and Android packaging stay unchanged** | P1 | Ship all new content inside `static/` so the existing asset copy reaches the Android bundle, within the stated per-language size budget and with no new permissions or plugins. |
| **F6.2** | **Every new string is translated** | P1 | Add all new UI strings to both dictionaries so the existing parity and `tr()` coverage tests keep passing. |
| **F6.3** | **Accessible, child-safe interaction** | P1 | Word roles must be distinguishable without colour, every control has an accessible name, touch targets meet the platform minimum, and nothing in the reading flow requires text input. |
| **F6.4** | **Existing card modes do not change behaviour** | P1 | Words, Flops, language switching, TTS disclaimers, progress counters and storage keys keep their current behaviour apart from the documented additions. |
| **F6.5** | **Automated tests and golden coverage values** | P1 | Cover coverage math, word roles, sentence segmentation, pattern decks, storage migration, the EPUB parser (EPUB 2 and 3 fixtures) and the bundled-book conversion, including a fixture book with exact expected percentages. |

---

## 4. Detailed requirements

### F1.1 Merge "ma" and "am" into one Patterns mode

* Replace the two `input[name="pattern"]` options `CV` and `VC` with one option `PATTERNS`, labelled
  "Muster" / "Patterns", whose card shows the same four placeholder labels used today:
  `ma` (Konsonant + Vokal), `am` (Vokal + Konsonant), `mam` (Konsonant + Vokal + Konsonant),
  `ama` (Vokal + Konsonant + Vokal).
* The sub-patterns are checkboxes inside the `PATTERNS` card. `ma` and `am` are checked on first load,
  which reproduces today's default deck exactly.
* `ma` is checked and `am` unchecked must produce exactly the deck that `CV` produces today, and the
  same holds for `am` ⇔ `VC`. This equivalence is a tested invariant.
* No other mode changes position, label or behaviour.

**Acceptance**

1. On first load the setup screen shows one "Muster" option with `ma` and `am` checked.
2. Selecting only `ma` yields the same card multiset as today's `CV` for the same card count.
3. Selecting only `am` yields the same card multiset as today's `VC`.
4. `mam` and `ama` are offered and selectable.
5. `WORDS` and `FLOP` are unchanged.

### F1.2 Generate decks from every selected sub-pattern

* Extend the deck builder so that a checked sub-pattern contributes
  `buildCombinations(<pattern>, selectedConsonants, selectedVowels)`, where `ma` = `CV`, `am` = `VC`,
  `mam` = `CVC`, `ama` = `VCV`.
* Concatenate all combinations, de-duplicate by exact card text, shuffle, and cut to the requested card
  count. If the requested count exceeds the pool, repeat the pool as today.
* Multiple patterns must be interleaved, not appended in blocks, so a deck does not contain a long run
  of one pattern.
* Capitalization behaviour (random uppercase first letter per card, as today) stays.
* With no sub-pattern checked: the start button is disabled and the setup error area explains that at
  least one pattern must be selected. No exception, no empty practice screen.
* `buildCombinations` must exist once. Today it is duplicated in `sounds.mjs` and inline in
  `index.html`; the inline copy is removed and the module version imported (it already supports any
  sequence of `C`/`V` slots, so `CVC` and `VCV` need no new algorithm).

**Acceptance**

1. A deck for `ma` + `am` contains cards of length 2 only; a deck for `mam` + `ama` contains cards of
   length 3 only; a deck for all four contains both lengths.
2. No duplicate card text in a deck.
3. Before shuffling, consecutive cards do not all come from one sub-pattern.
4. Empty selection blocks the start.

### F1.3 Patterns strings and regression coverage

* New German/English keys, at minimum: `setup.pattern.patterns`, `setup.pattern.patterns_desc`,
  `setup.pattern.sub.ma`, `setup.pattern.sub.am`, `setup.pattern.sub.mam`, `setup.pattern.sub.ama`,
  `setup.error.no_pattern`.
* Remove `setup.pattern.cv` / `setup.pattern.vc` only if nothing references them afterwards; the
  existing tests fail otherwise, which is the intended safety net.
* Add `tests/patterns.test.mjs` for the deck builder and the empty-selection guard, and keep
  `tests/sounds.test.mjs` green.

**Acceptance**

1. `cd sites/lesen && node --test tests/*.test.mjs` passes.
2. No `tr('…')` key is missing in German (existing test).

### F2.1 Bundle sixteen public-domain books offline

* Ship exactly the eight German and eight English works in section 5, **complete** (D4): every paragraph
  of each committed EPUB, uncurated and unabridged. Excerpting is a later editorial pass (§5.6), not
  part of this drop, and no issue may block on it.
* Files live under `sites/lesen/static/books/` (manifest plus one canonical JSON per book), produced
  by the shared EPUB importer (F5.1, F5.2) from the committed sources in `sites/lesen/books-src/`
  (D1). Nothing is fetched at runtime; no new origin, CDN or backend.
* A book with no paragraphs must never appear in the manifest.
* The manifest carries a `schemaVersion`, the generation date, the source EPUB checksum and, per book,
  the metadata used by F5.3 and F5.4.

**Acceptance**

1. With the device offline and the network disabled in devtools, the picker lists sixteen books and a
   book opens and reads.
2. The Android bundle contains the same files after `npm run copy-assets` (no build-script change).
3. A manifest referencing a missing file fails the build and the app shows a readable error, not a
   blank screen.

### F2.2 Show the readability percentage per book

* Use the metric defined in section 6. Show two numbers per book:
  **"82 % der Wörter lesbar"** (token share, primary) and **"64 % der verschiedenen Wörter"**
  (type share, secondary).
* Recompute when the letter/special selection changes, without a page reload.
* Percentages are shown with no decimal and a `≈` prefix or an explicit "theoretisch" label, because
  the number is a decoding estimate, not comprehension.
* Never display `100 %` unless the share is exactly 100 %.
* The same function must be used by the picker, the reader and the build tool's `--check` output.

**Acceptance**

1. Changing a single letter updates every visible percentage.
2. Adding a sound never lowers a percentage (monotonicity test).
3. The picker and the reader agree on the value for the same book and selection.

### F2.3 Book picker with coverage, difficulty and progress

* The setup screen gains two tabs: **"Karten"** (the existing screen, unchanged) and
  **"Geschichten"** (new). The language control stays above both tabs and selects the reading language
  as well as the word list; the library shows only books of that language.
* Each book row shows: title, author + year, coverage chip, average adult words per sentence,
  a difficulty hint (`leicht` / `mittel` / `anspruchsvoll`), and either "Noch nicht begonnen" or
  "Weiter bei Satz 12".
* Sorted by token coverage descending, then by average adult words per sentence ascending.
* Opening a book requires no other setup step; the current letter selection applies.
* If no book reaches 60 % token coverage, the tab shows a hint to add letters or specials plus a
  button that returns to the letter selection.

**Acceptance**

1. Both tabs work at 320 px width and in the Android WebView.
2. Switching the language swaps the book list.
3. Rows are keyboard reachable and have accessible names that include title and coverage.

### F2.4 Explain what the percentage means and what is missing

* A collapsible explanation next to the coverage chip states: the percentage counts the words in this
  book that can be decoded with the selected sounds; it says nothing about whether the child
  understands the story.
* The same panel lists the five most frequent words the adult would have to read, and up to three
  sounds whose addition would raise this book's coverage most (measured on a bounded sample).
* The panel is informational only; nothing in it changes the selection automatically.

**Acceptance**

1. The explanation is present in both languages.
2. The "missing sounds" list is deterministic for the same book and selection.
3. The suggestion computation stays within the F2.5 budget.

### F2.5 Coverage caching and performance budget

* Cache per `(bookId, selectionHash)`. Selection hash covers selected consonants, vowels and specials.
* Compute the library in chunks so the picker paints first; no task longer than 16 ms on the main
  thread.
* Budget: the whole shipped library (both languages, ≤ 300 000 characters of curated text) computes in
  ≤ 50 ms on a mid-range Android device (reference: 4× CPU throttling in Chrome DevTools as a proxy for
  a mid-range phone), and switching one letter re-renders in ≤ 100 ms.
* No `localStorage` writes during computation; caches are in memory only.

**Acceptance**

1. Measured with the documented throttling, the budget holds; the measurement is described in the PR.
2. Repeated tab switches do not recompute from scratch.

### F3.1 Read sentence by sentence inside paragraph context

* The reader shows the current paragraph in full. Sentences before and after the current one stay
  visible at reduced emphasis; the current sentence is the focus. Paragraph breaks are preserved.
* Verse paragraphs (`Die Heinzelmännchen`, the fables, *A Child's Garden of Verses*) keep their source
  line breaks; a verse line is never reflowed into a prose line.
* Long paragraphs must not produce an unusable page: if the paragraph exceeds a configured height
  (for example 60 % of the viewport), the reader may window the sentences around the current one while
  keeping at least one neighbouring sentence visible and showing a "mehr" affordance.
* The sentence itself is never truncated, split or abbreviated.
* The current sentence is announced to screen readers as the focused element.

**Acceptance**

1. Advancing one sentence keeps the surrounding paragraph text stable (no full re-layout jump).
2. A verse fixture keeps line breaks exactly as in the source JSON.
3. No sentence is rendered clipped at 320 × 480.

### F3.2 Mark which words the child reads and which the adult reads

* Classify each word of the current sentence with the same rules used for coverage (section 6):
  every sound unit in the selected set ⇒ **child word**, otherwise **adult word**.
* Child words render in the normal reading style; adult words render in a second, clearly different
  style that survives greyscale (for example lower contrast plus a dotted underline). The difference
  must not rely on hue alone.
* A legend sits directly above the text with one example word per role, worded for the child, e.g.
  "Du liest" / "Erwachsener liest".
* Every word exposes an accessible label that includes its role, e.g. "König, du liest" /
  "Heinzelmännchen, Erwachsener liest".
* The classification updates immediately when the selection changes, including while a book is open.
* Sentence-level summary: "5 von 8 Wörtern liest du" so the child knows what to expect before starting.

**Acceptance**

1. A word containing one unselected sound is marked adult, even if all other sounds are known.
2. Removing a sound re-marks affected words without leaving the reader.
3. With `filter: grayscale(1)` applied, both roles remain distinguishable.
4. Screen reader output includes the role for every word.

### F3.3 Adult support for words with unknown letters

* Tapping an adult word opens a small, dismissible panel with the word, the missing sounds
  ("fehlend: ä, nk"), and a speaker button that reads the word aloud with the existing speech adapter
  (`rate` ≈ 0.8, language from the book).
* Tapping a child word may also speak it (optional confirmation), but must never mark the card.
* There is no autoplay. The one-time TTS disclaimer flow is reused; unsupported/no-voice/error states
  reuse the existing feedback strings.
* Audio is best-effort: the entire flow must work with speech unavailable, and the panel must still
  show the missing sounds.

**Acceptance**

1. With speech disabled (`speechSynthesis` undefined), the panel opens and shows missing sounds.
2. With speech available but no German/English offline voice, the existing "no voice" feedback appears.
3. Speech stops when leaving the reader.

### F3.4 Navigate, resume and track progress

* Controls: previous sentence, next sentence, previous paragraph, next paragraph, back to the book
  list, and "Als Karte üben" (F4.1).
* Progress display: sentence index within the book, plus a coarse percentage of sentences read.
* The last position per book is persisted (`buchstabenzeit:reading-progress`, see section 7.4) and
  offered as "Weiterlesen" when the book is reopened; never jump automatically.
* **Automatic resume and bookmarks are different features.** This requirement is the single "where I
  stopped" position, written implicitly as the child reads. A bookmark (F3.7) is an explicit mark the
  adult places and may keep several of. Both use the same stable sentence ids, but separate storage.
* If a stored position no longer exists (book content changed), fall back to the nearest earlier
  paragraph and continue without an error dialog.
* Reaching the end shows a completion state with "Nochmal" and "Anderes Buch".

**Acceptance**

1. Position survives a browser reload and an app restart.
2. A stale position does not break opening the book.
3. Every control is reachable without a mouse.

### F3.5 Filter and order sentences by adult-word count

* Before starting a book, the adult can set a maximum number of adult words per sentence
  (0, 1, 2, 3, "alle"; default 2) and choose the order: book order, easiest first.
* Sentences filtered out are not shown; the reader makes clear that it is showing a subset
  ("Sätze mit höchstens 2 Erwachsenen-Wörtern: 143 von 1 552").
* The filter is per session and does not modify the book; "alle" restores full text.
* The default must be discoverable but not annoying: it is a control on the book row, remembered per
  book for the session.

Rationale: measured over whole works, only 8–32 % of sentences have no adult word at the reference
"Startset" (section 5.5). Without a filter, a beginner meets an unreadable sentence almost immediately.

**Acceptance**

1. A filter of 0 shows only fully readable sentences; the count matches the computed profile.
2. Switching back to "alle" restores the full text with the same current position.

### F3.6 Show the illustration of an excerpt

* For a book whose manifest lists images, the reader shows the plate that belongs to the current
  excerpt, above the paragraph and below the progress line.
* The plate has meaningful `alt` text from the manifest (a short description, not the file name), is
  `loading="lazy"`, and does not scale beyond its natural width so small screens do not upscale.
* The plate never pushes the current sentence out of view: at 320 × 480 the current sentence stays
  visible with the plate present, which in practice caps the plate height (60 % of the viewport, with
  the sentence area guaranteed at least three lines).
* Tapping the plate opens it full-screen at natural size with a close control; no other gesture, no
  autoplay, no animation that could distract.
* A book without images renders exactly as it does today, with no placeholder and no layout shift.
* If an image file is missing at runtime, the reader logs nothing user-visible and simply omits it; the
  text must never fail to render because of an image.

**Acceptance**

1. *Der Struwwelpeter* shows a plate on an excerpt that has one and none on an excerpt that does not.
2. *Die Heinzelmännchen* (no images) renders identically to the pre-change layout.
3. At 320 × 480 with the plate shown, the current sentence is fully visible without scrolling.
4. Removing an image file from the bundle degrades to text only, with no error state.

### F3.7 Bookmark the current sentence and return to it later

Purpose: automatic resume (F3.4) answers "where did I stop"; a bookmark answers "remember this
passage". They are separate features with separate storage, and conflating them would make both worse.

* A bookmark is anchored to a sentence id (`s|<bookId>:<paragraphId>:<sentenceId>`) — the same stable id
  sentence cards use — plus `createdAt`. No sentence text is stored, so a bookmark can never contradict
  a corrected book.
* **Toggle, not a dialog:** one control in the reader, "Merken" / "Gemerkt", exposing `aria-pressed` and
  operable by keyboard. The same control removes the mark. No confirmation for the common case.
* Multiple bookmarks per book, up to 50. At the cap, adding is refused with a plain message; the oldest
  is **never** silently dropped. A duplicate at the same sentence is impossible because it is a toggle.
* The marked sentence carries a margin marker inside the paragraph context, so it is visible while
  reading around it. The marker uses a glyph plus weight, not colour alone (F6.3).
* A bookmark list for the current book: each entry shows the sentence text truncated to about 80
  characters, its paragraph position, and "Weiterlesen" and "Entfernen". The list is reachable from the
  reader; the book row in "Geschichten" shows the bookmark count and opens the same list.
* Jumping to a bookmarked sentence sets the current position and updates reading progress from there. It
  never creates a second, competing notion of "where I am".
* **Jumping overrides the F3.5 filter for that one jump**, so a filtered session can still reach a marked
  sentence. The filter setting itself is left unchanged afterwards.
* A bookmark is not a card: it never touches Flops, statistics or the card count, and marking a sentence
  is not the same action as "Als Karte üben" (F4.1).
* A bookmark whose sentence no longer exists — possible after a book is re-converted following curation —
  is shown as "nicht mehr verfügbar" with a delete action. The book still opens and reading continues.
* Bookmarks persist per device (`buchabenzeit:bookmarks`, §7.5) and are never uploaded or synced.

**Acceptance**

1. Mark two different sentences, reload, and both are still marked and listed in the same order.
2. Toggling the same sentence twice adds and then removes it, producing no duplicate.
3. Jumping from the list lands on that exact sentence with its full paragraph visible.
4. With a filter of 0 adult words active, a bookmarked sentence that violates the filter is still
   reachable by jumping to it, and the filter value is unchanged afterwards.
5. A bookmark pointing at a removed sentence shows "nicht mehr verfügbar", can be deleted, and does not
   prevent the book from opening.
6. The 51st bookmark is refused with a message and the existing 50 are unchanged.
7. `aria-pressed` reflects the true state, and the marker is distinguishable with `filter: grayscale(1)`.
8. Marking and unmarking is a single tap on a 44 × 44 px target and takes no measurable time on a book
   with 2 000 sentences.

### F4.1 Send a sentence to practice as a card

* "Als Karte üben" adds the current sentence to a persistent collection and confirms with a short
  message ("Satz als Karte gemerkt") and a running count.
* The collection is available on the "Karten" tab as a deck ("Gesammelte Sätze: 12") and starts the
  existing practice screen.
* A sentence card shows the sentence with the same child/adult word marking as the reader, because the
  adult reads the marked words and judges whether the child read the rest correctly.
* The adult marks the card with the existing "Richtig gelesen" / retry buttons; no new interaction mode.
* Removing a collected sentence is possible from the reader and from the deck summary.

**Acceptance**

1. A collected sentence survives reload and appears in the deck.
2. Marking a sentence card updates its counters and the practice progress exactly like a word card.
3. The same sentence from two different books yields two independent cards.

### F4.2 Stable card identity and statistics schema v2

* Introduce a card identity independent of the display text:
  `w|<text>` for word/pattern cards and `s|<bookId>:<paragraphId>:<sentenceId>` for sentence cards.
* Storage value becomes
  `{ "version": 2, "cards": { "<cardId>": { "kind": "word"|"sentence", "text": "…", "bookId"?: "…", "correct_count": n, "incorrect_count": n } } }`
  under the existing key `buchstabenzeit:card-stats`.
* Migration: an unversioned flat map is read as word cards, keeping every counter exactly and keying by
  `w|<originalKey>`. Migration is idempotent and runs on first read. Corrupt or unreadable JSON still
  yields empty statistics (current behaviour).
* `recordAttempt` keeps working on a plain counter map; a new `recordCardAttempt` (or equivalent) adds
  the card identity layer. `selectFlopDeck` and `flopCandidateCards` read text and kind from the
  registry instead of assuming keys are card texts.
* Display text with different letter casing remains a distinct word card, as today.
* A collected sentence stores its text at collection time. If the book is later updated, the card keeps
  its stored text and its counters; it is not silently re-pointed to new content.

**Acceptance**

1. A v1 fixture with three cards migrates to v2 with identical counters and no data loss.
2. Running migration twice produces the same result.
3. Flop selection for word cards returns the same cards as before migration.
4. Unknown or future `version` values are treated as empty rather than crashing.

### F4.3 Sentence cards participate in Flops

* Sentence cards whose `bookId` language equals the current session language are eligible for Flop
  Training, regardless of current letter selection.
* Word cards keep the existing `isSpellableWith` filter.
* Sentence cards are ordered by success rate with the same bottom-10 % rule (min 1, max 30) and the
  same 3-points-for-correct behaviour.

**Acceptance**

1. A sentence card with a wrong attempt appears in Flops even if its words are not spellable.
2. A sentence card from the other language does not appear.

### F4.4 Sentence decks alongside word decks

* The "Karten" tab offers: the existing letter/word deck, the collected-sentence deck, and optionally a
  mixed deck (letter cards + collected sentences).
* Card counts, progress and completion screens use the existing semantics.
* A mixed deck interleaves sentence and word cards rather than grouping them.

**Acceptance**

1. The sentence deck starts the practice screen with only sentence cards.
2. A mixed deck alternates card kinds.
3. Completion counts match the deck size.

### F5.1 One EPUB ingestion module, used at build time

The importer is a **build-time tool**, not app code. That is the whole simplification: no ZIP handling,
no decompression and no WebView capability question ever reaches the device, because the device only
ever receives pre-converted canonical JSON.

* New pure module `sites/lesen/tools/epub.mjs`, no dependencies, no DOM access.
* Signature: `parseEpub(bytes, { inflate }) -> canonical book`. The DEFLATE step is **injected**, so the
  module itself contains no decompressor: the build passes Node's `zlib.inflateRawSync`, and a future
  runtime importer could pass `DecompressionStream` without touching this file.
* Responsibilities, in order: open the ZIP container; read `META-INF/container.xml` to find the package
  document; read the package document for metadata, manifest and spine; iterate the spine in reading
  order; reduce XHTML to text; collect images; emit the canonical book model (F5.2).
* EPUB 2 (NCX) and EPUB 3 (nav document) are both accepted. The spine defines order; the NCX/nav is
  used only for chapter titles.
* Because it runs offline in the build, the parser is not bound by device limits. It still rejects
  malformed archives (missing `container.xml`, empty spine, truncated ZIP, encrypted entries) with a
  clear error, so a bad source fails the build instead of producing a broken book.
* **Consistency guarantee:** the sixteen real sources in `sites/lesen/books-src/` are the test corpus, so
  no separate fixtures are needed for them. A test re-converts them and asserts the emitted model equals
  the committed canonical JSON byte for byte, and `build_books.mjs --check` repeats that over all
  sixteen. One small EPUB 2 fixture is still committed, because every bundled source is EPUB 3.

**Acceptance**

1. `tools/epub.mjs` imports nothing outside the Node standard library and does not touch `window`.
2. A bundled EPUB 3 source and a small EPUB 2 fixture both parse to the same canonical shape.
3. The bundled books re-run through the importer produce byte-identical JSON to what is committed.
4. The module contains no decompression code of its own; removing the injected `inflate` makes it fail
   with a clear error rather than silently returning empty data.
5. An encrypted EPUB is rejected with an explicit "copy-protected source" error.

### F5.2 Canonical book model and build-time conversion

* The importer emits the canonical model described in §7.2: book metadata plus paragraphs containing
  precomputed sentences, stable ids, prose/verse markers and image references.
* Sentence segmentation happens once, in the importer, from the source HTML (`p`, `div`, `h*`, `li`,
  `blockquote` boundaries preserved as paragraphs; sentences split on `. ! ? …` followed by whitespace
  and an upper-case letter or a quote). The runtime never segments text.
* Verse is detected per paragraph: if most lines of a paragraph end without sentence punctuation the
  paragraph is `verse` and its line breaks are kept; otherwise it is `prose` and its hard-wrapped lines
  are joined. A publisher's verse markup (`<br>` per line) is honoured as verse directly.
* Bundled books are produced by running this importer once and committing the output JSON. **No
  hand-edited text files are part of the pipeline**: `sites/lesen/tools/build_books.mjs` calls
  `tools/epub.mjs`, and its `--check` mode compares committed output with a fresh conversion.
* The canonical JSON is small (text plus an image list) even though the source EPUBs are large, which
  keeps the paid Android download within the F6.1 budget.
* Adding a bundled book is therefore: run the importer on a new EPUB, commit the JSON, add a manifest
  entry. There is no separate authoring format to learn.

**Acceptance**

1. `node tools/build_books.mjs --check` exits non-zero when a committed book differs from a fresh
   conversion.
2. Re-running the conversion twice produces byte-identical files.
3. No committed file under `static/books/` contains source HTML, `&nbsp;`, or Gutenberg boilerplate.

### F5.3 Public-domain gate for bundled books

* Applies to every book the build ships, which is all of them: the app has no other source of books.
* The manifest records per bundled book: `title`, `author`, `authorDeathYear`, `firstPublicationYear`,
  `translator` (or `null`), `illustrator` and `illustratorDeathYear` (or `null`), `source` (name, URL,
  edition, EPUB SHA-256), `licenseBasis`, optional `contentNote`.
* Conversion fails when any field is missing, when `authorDeathYear` is not below `euDeathYearBelow`
  (as of 2026: 1956), when `firstPublicationYear` exceeds `usPublicationYearAtMost` (as of 2026: 1930),
  or when a named translator or illustrator fails the same death-year test.
* Cutoffs are named constants with the year they were validated, re-validated each January.
* The check is code, not a convention: a test feeds a book whose author died in 1980 through the gate
  and expects a rejection.

**Acceptance**

1. A fixture book by an author who died in 1980 fails with a clear message.
2. A fixture book first published in 1935 fails.
3. A named translator who died in 1970 fails, and an illustrator who died in 1990 fails.
4. All sixteen bundled books pass and the manifest states the basis.

### F5.4 In-app book credits

* The about/legal dialog gains a "Bücher" section listing all bundled books: title, author, illustrator,
  year, source and public-domain basis, in the currently selected language.
* Text is loaded from the manifest, never duplicated in markup, so credits cannot drift from content.
**Acceptance**

1. All sixteen books appear after a manifest change without editing markup.
2. *Der Struwwelpeter* names Hoffmann as author and illustrator.
3. German and English headings and explanatory sentence exist.

### F5.5 Extraction rules are explicit and lossless

Because the input is HTML inside an EPUB, extraction is structural rather than regex-scrubbing of plain
text, which removes the whole class of boilerplate problems:

* Remove `script`, `style`, `head` and comment nodes; unwrap the rest.
* Treat `p`, `div`, `h1`–`h6`, `li`, `blockquote`, `br` as paragraph or line boundaries; never join
  across a paragraph boundary.
* Decode HTML entities to characters; normalize non-breaking spaces to normal spaces; collapse runs of
  whitespace inside a paragraph.
* Keep every word. No modernization, no abridging, no vocabulary simplification, no hyphenation repair
  that changes a word.
* Project Gutenberg header/footer and licence paragraphs, and Wikisource metadata blocks, are dropped by
  an explicit, tested list of section boundaries — not by a heuristic on the text.
* Every rule is documented in `static/books/README.md` with one example each.

**Acceptance**

1. A fixture paragraph containing `&nbsp;`, an em dash, a soft hyphen and a `<br>` yields the expected
   text with the correct paragraph/line structure.
2. A fixture with historical spelling ("bey", "Thür") keeps it.
3. No output sentence differs from its source excerpt other than by the documented extraction rules.
4. Sentence count and paragraph count for *Der Struwwelpeter* are recorded in the manifest and asserted
   by a test, so a regression in extraction is visible.

### F5.6 Illustrations come from the book itself

* Images are taken from the EPUB manifest, so a bundled book gets the complete plate set the edition
  actually contains — the plain-text edition of *Der Struwwelpeter* exposed 8 images while its EPUB
  carries 32, and only the EPUB has the full set.
* An image ships only when the book's `illustratorDeathYear` passes F5.3. For *Der Struwwelpeter* the
  illustrator is the author (Hoffmann, d. 1894), so its plates qualify; no other book in this drop ships
  images.
* Each image is recorded with `file`, `sha256`, `width`, `height`, `alt`, `caption` and the paragraph it
  belongs to.
* Build-time conversion re-encodes images to JPEG with a long edge of ≤ 900 px and a per-file cap, and
  records the source image's checksum so the re-encode is auditable.
* Alt text is never the file name and never the bare word "Illustration" (D15). In this drop it is
  generated deterministically from the chapter title and the plate's index within that chapter, in the
  book's language, so it is accurate without inventing a scene description. A later editorial pass may
  replace it with prose. The converter fails when a plate would end up with empty alt text.

**Acceptance**

1. A book whose illustrator fails the death-year test is rejected even when the author passes.
2. Every shipped image has non-empty alt text, a checksum and a known target paragraph.
3. The image budget of F6.1 holds and the committed images are the re-encoded ones.
4. *Die Heinzelmännchen* (no images) ships and renders without any image code path being exercised.

### F6.1 Offline and Android packaging stay unchanged

* All new content under `sites/lesen/static/`; no new network access, no new Capacitor plugin or
  permission, and no change to the Android project.
* Budget, revised for complete works (D4). The fifteen text-only works total ≈ 577 000 words, so the
  canonical JSON must stay compact: store paragraph text with implicit positional ids rather than a
  per-sentence object with a string id, and keep the whole library **≤ 5 MB of JSON**, ≤ 700 KB per
  book file, manifest ≤ 20 KB. Images are budgeted separately: ≤ 3 MB total, ≤ 120 KB per plate, long
  edge ≤ 900 px (only *Der Struwwelpeter* has plates).
* Lazy-load each book file only when it is opened; never load the whole library to render the picker
  beyond the manifest's precomputed coverage.
* The app must start and read with the device in flight mode.

**Acceptance**

1. `npm run copy-assets` then a debug build contains the books and works offline.
2. Repository size for content stays inside the budget (checked by a test).

### F6.2 Every new string is translated

* All new keys in `i18n.mjs` for both languages, including reader controls, legend, coverage labels,
  filter labels, error strings and credits.
* No string composed by concatenating translated fragments (German grammar); use full sentences with
  placeholders where needed.
* Existing tests must pass unchanged.

**Acceptance**

1. `node --test tests/i18n.test.mjs` passes.
2. A reviewer reading only English sees no German leftovers in new UI.

### F6.3 Accessible, child-safe interaction

* Roles not conveyed by colour alone (see F3.2); contrast of both role styles ≥ 4.5:1 against the page
  background for the primary text style, and ≥ 3:1 for the secondary style with a non-colour cue.
* Touch targets ≥ 44 × 44 px; the reader's primary controls are in the lower half of the screen.
* Every icon button has an accessible name; the legend uses plain words a six-year-old can read.
* No text input, no timers, no scoring pressure, no autoplay audio.
* Layout works at 320 px width and with 200 % text zoom.

**Acceptance**

1. Keyboard-only navigation covers tabs, book list, reader controls and the adult word panel.
2. Greyscale and 200 % zoom checks documented in the PR.

### F6.4 Existing card modes do not change behaviour

* Words Mode counts, Flop Training selection, language switching, TTS disclaimer behaviour, progress
  labels and the existing storage key remain as they are, except for the documented patterns merge and
  statistics migration.
* `countMatchingWords`, `WORDS_MODE_THRESHOLD` and `isWordsModeEligible` are untouched.
* Book vocabulary must not be merged into `words-de.json` / `words-en.json`; the deliberate exclusion
  of English-origin words from the German list stays intact.

**Acceptance**

1. Existing test files pass without modification except where this document explicitly changes
   behaviour.
2. `words-de.json` and `words-en.json` are byte-identical after the change.

### F6.5 Automated tests and golden coverage values

* New pure modules are covered by `node:test`, matching the existing `tests/*.test.mjs` suite.
* The EPUB importer is tested against committed fixtures: one EPUB 3 and one EPUB 2, each small, with
  exact expected canonical output. No network access in any test.
* Include a fixture book (a few sentences, both a prose and a verse paragraph) with exact expected
  token/type coverage for the four reference selections, so tokenizer drift is caught.
* Property test: adding a sound to a selection never decreases coverage.
* Migration and Flop regressions covered by fixtures, not by mocks of the implementation.
* Bookmark storage is tested for round-trip, toggle-without-duplicate, the 50-per-book cap, unknown
  `version` treated as empty, and a stale sentence id degrading to a deletable entry.
* Refusal paths (DRM, truncated ZIP, empty spine, oversized archive) are table-driven tests, one row
  per message.
* The importer's injected `inflate` is exercised through the real Node decoder, so the tests cover the
  same code path the build uses.

**Acceptance**

1. `cd sites/lesen && node --test tests/*.test.mjs` passes.
2. `cd sites/lesen && node tools/build_books.mjs --check` passes and fails when a committed book is
   edited by hand.
3. Golden values change only with an intentional tokenizer change and a documented update.
4. Every importer refusal path (encrypted source, truncated ZIP, missing `container.xml`, empty spine)
   has at least one test.

---

## 5. Book selection: eight German and eight English works

### 5.1 Selection rules

1. **Public domain in both markets.** EU: author (and translator, if any) died before 1956
   (70 years p.m.a. as of 2026). US: first published in 1930 or earlier.
2. **German-original preferred.** German translations of foreign works are avoided unless the
   translator also passes rule 1; the list below contains no translation except Bürger's
   *Münchhausen*, whose translator is Bürger himself (d. 1794).
3. **Age band 6–9.** Short texts, concrete vocabulary, episodic structure; longer works are shipped as
   curated excerpts.
4. **Illustrations only where the illustrator's rights are equally clear.** Hoffmann drew his own
   pictures for *Der Struwwelpeter* (d. 1894), so its plates are public domain too and ship with the
   text. Shepard's 1930s *Willows* drawings do not qualify; the other books ship text-only. Rules in
   F5.6.
5. **Decodable.** Prefer works with high coverage at the "Startset" and with short sentences
   (section 5.5).
6. **Content note required** where a work carries violence, threat or dated language; the note is
   shown in the book credits and the excerpt choice avoids the worst passages.

### 5.2 Reference selections used for the numbers

These four selections are fixed for comparison and are part of the build tool's manifest output.

| Name | German | English |
|---|---|---|
| **S0** "erste Buchstaben" | consonants `m l s r t n p`, vowels `a i e`, no specials | consonants `m l s r t n p`, vowels `a i e`, no specials |
| **S1** "alle Buchstaben" | every single-letter consonant and vowel the app offers (incl. `ß`), no specials | every single-letter consonant and vowel the app offers, no specials |
| **S2** "Startset" | `b d f g h k l m n p r s t w z` + `a e i o u` + `au ei ie eu ch sch st xx` | `b c d f g h k l m n p r s t w` + `a e i o u` + `sh ch th oo ee ai ou xx` |
| **S3** "alles" | every letter and every special the app offers | every letter and every special the app offers |

S3 is not a teaching stage: it is the metric's sanity anchor. It must yield exactly 100.0 % on every
book, which proves that the coverage function and the tokenizer agree. If S3 ever reports less than
100 %, the metric is wrong.

Numbers below were measured on **2026-10-29** with the app's own tokenizer (`sounds.mjs`
`tokenizeWord`) over the whole fetched work after the normalization rules of F5.5, i.e. **uncurated**,
so the choice of text is not flattered by excerpting. They are indicative for choosing and curating;
the manifest values are authoritative for the shipped excerpts.

### 5.3 German books (8)

| # | Work | Author (d.) | First publ. | Words | Types | S0 | S1 | S2 words / types | S3 | Sentences | Ø words / sent. | Ø adult / sent. | 0 adult | ≤ 2 adult | Most frequent adult words at S2 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Fünfzig Fabeln für Kinder | Wilhelm Hey (1854) | 1833 | 1 962 | 745 | 8.8 % | 52.5 % | 90.0 % / 84.2 % | 100 % | 139 | 14 | 1.4 | 29 % | 81 % | von (8), für (6), vor (5) |
| 2 | Der Struwwelpeter | Heinrich Hoffmann (1894) | 1845 | 3 101 | 1 113 | 9.7 % | 51.9 % | 89.6 % / 79.7 % | 100 % | 168 | 18 | 1.9 | 32 % | 74 % | von (18), vom (10), ja (8) |
| 3 | Deutsche Märchen (Brüder Grimm) | Jacob (1863) / Wilhelm (1859) | 1812 | 90 172 | 8 657 | 10.0 % | 53.7 % | 89.2 % / 72.6 % | 100 % | 2 230 | 40 | 4.4 | 8 % | 41 % | von (311), könig (262), vor (219) |
| 4 | Heidis Lehr- und Wanderjahre | Johanna Spyri (1901) | 1880 | 52 359 | 5 738 | 10.0 % | 50.2 % | 89.0 % / 72.7 % | 100 % | 1 552 | 34 | 3.7 | 13 % | 48 % | von (249), jetzt (220), vater (214) |
| 5 | Die Heinzelmännchen | August Kopisch (1853) | 1836 | 518 | 271 | 7.3 % | 51.7 % | 88.0 % / 80.4 % | 100 % | 28 | 19 | 2.2 | 21 % | 57 % | heinzelmännchen (5), männlein (3), backten (2) |
| 6 | Peterchens Mondfahrt | Gerdt von Bassewitz (1923) | 1912 | 18 387 | 3 386 | 8.7 % | 45.5 % | 87.0 % / 74.6 % | 100 % | 742 | 25 | 3.2 | 13 % | 55 % | maikäfer (121), ja (103), sandmännchen (99) |
| 7 | Die Biene Maja und ihre Abenteuer | Waldemar Bonsels (1952) | 1912 | 37 245 | 5 520 | 8.3 % | 48.4 % | 86.8 % / 72.5 % | 100 % | 1 615 | 23 | 3.0 | 13 % | 54 % | maja (473), von (191), über (129) |
| 8 | Des Freyherrn von Münchhausen Wunderbare Reisen | Gottfried August Bürger (1794) | 1786 | 14 767 | 3 784 | 8.4 % | 49.1 % | 86.4 % / 73.6 % | 100 % | 556 | 27 | 3.6 | 11 % | 46 % | von (161), über (42), bey (32) |

*Der Struwwelpeter* is the easiest German book measured: 32 % of its sentences need no adult at all and
74 % need at most two, because every story is a short rhymed stanza. It is also the only German book
that ships **with its illustrations** (F5.6), since Hoffmann was both author and illustrator.

"0 adult" and "≤ 2 adult" are the shares of sentences the child could read completely at S2, and the
default session filter of F3.5. "Ø adult / sent." is the average number of adult words per sentence.

**Content notes:** *Die Biene Maja* carries dated nature imagery and the author's later writing is
controversial; *Münchhausen* contains hunting and war tall tales; the Grimm collection contains
canonical fairy-tale violence and a few antisemitic passages in the scholarly annotations, which must
stay out of the excerpts. *Heinzelmännchen*, *Fünfzig Fabeln* and *Peterchens Mondfahrt* are
unproblematic.

**German-specific findings**

* With single letters only (S1), German tops out at **46–54 %**. The umlauts `ä ö ü` are *specials* in
  the app's sound model, not letters, so they are missing at S1 and are frequent in German.
* `ß` is in the S1 letter set, but barely matters; the diphthongs matter far more.
* Many adult words are function words (`von`, `vor`, `für`, `über`) — the child can sound out `v-o-n`
  but the word still counts as adult until `v` (or `ü`/`ä`/`ö`) is selected. See §6.4.

### 5.4 English books (8)

| # | Work | Author (d.) | First publ. | Words | Types | S0 | S1 | S2 words / types | S3 | Sentences | Ø words / sent. | Ø adult / sent. | 0 adult | ≤ 2 adult | Most frequent adult words at S2 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | The Tale of Peter Rabbit | Beatrix Potter (1943) | 1902 | 1 036 | 400 | 14.7 % | 80.1 % | 90.9 % / 85.5 % | 100 % | 59 | 17 | 1.6 | 29 % | 76 % | very (8), by (5), jacket (5) |
| 2 | The Secret Garden | Frances Hodgson Burnett (1924) | 1911 | 83 540 | 4 837 | 16.1 % | 74.7 % | 88.3 % / 78.2 % | 100 % | 4 735 | 18 | 2.1 | 21 % | 69 % | you (803), mary (694), they (483) |
| 3 | Alice's Adventures in Wonderland | Lewis Carroll (1898) | 1865 | 27 427 | 2 576 | 17.3 % | 71.9 % | 87.6 % / 78.7 % | 100 % | 918 | 30 | 3.7 | 11 % | 47 % | you (411), they (152), very (144) |
| 4 | The Railway Children | Edith Nesbit (1924) | 1906 | 62 264 | 4 686 | 17.1 % | 73.5 % | 87.3 % / 78.6 % | 100 % | 3 327 | 19 | 2.4 | 20 % | 63 % | you (1039), they (513), phyllis (292) |
| 5 | The Wind in the Willows | Kenneth Grahame (1932) | 1908 | 60 767 | 6 472 | 15.5 % | 75.9 % | 87.1 % / 77.4 % | 100 % | 2 429 | 25 | 3.2 | 14 % | 51 % | you (761), they (395), by (257) |
| 6 | Just So Stories | Rudyard Kipling (1936) | 1902 | 30 510 | 2 873 | 15.4 % | 75.0 % | 86.8 % / 80.9 % | 100 % | 839 | 36 | 4.8 | 11 % | 42 % | you (503), my (211), they (169) |
| 7 | The Wonderful Wizard of Oz | L. Frank Baum (1919) | 1900 | 40 000 | 2 933 | 13.5 % | 71.7 % | 86.6 % / 80.1 % | 100 % | 1 612 | 25 | 3.3 | 9 % | 44 % | you (495), they (403), dorothy (369) |
| 8 | Five Children and It | Edith Nesbit (1924) | 1902 | 56 319 | 4 828 | 15.7 % | 73.2 % | 86.0 % / 77.4 % | 100 % | 2 640 | 21 | 3.0 | 13 % | 55 % | you (912), they (568), cyril (239) |

**Content notes:** *Just So Stories* contains colonial-era framing and caricature in a few stories
("How the First Letter was Written"); those stories stay out. *The Secret Garden* uses dated language
about India and about illness/disability; excerpt choice avoids it. *The Railway Children* turns on the
father's wrongful arrest, which needs a sentence of explanation. *Alice* has nonsense wordplay and a
threatening Queen and suits the upper end of the age band. *The Wind in the Willows* and *Just So
Stories* have the longest sentences and will mostly be adult-read at S2.

**English-specific finding:** English reaches **72–80 %** with single letters alone, so English looks
easy early but then stalls: the residual gaps are dominated by `y` (you, they, very, my, any) and by
names. `y` is not in S2, which is why `you` and `they` appear as the most frequent adult words in
almost every book.

### 5.5 What the numbers mean for the feature

* At **S0** no book is readable (7–17 % of words). The mode must not pretend that a book is readable
  just because it is bundled; the percentage is the honest gate.
* At **S2**, 86–91 % of running text is decodable, but only **8–29 % of sentences** contain no adult
  word. Book-level percentage alone is not enough; the sentence filter (F3.5) and the per-sentence word
  roles (F3.2) are what make the mode usable for a six-year-old.
* German sentences are long in the long-form books (Grimm averages **40 words** per sentence, Heidi 34,
  Biene Maja 23); *Fünfzig Fabeln* averages 14 and *Die Heinzelmännchen* 19. Curated excerpts must
  prefer short sentences; the build tool reports the distribution so curation is measurable.
* Proper names dominate the adult words in several books (`maikäfer`, `sandmännchen`, `maja`,
  `heinzelmännchen`, `mary`, `dorothy`, `phyllis`, `cyril`). A name taught once unlocks many words, so
  the frequent-adult-word list in F2.4 is directly actionable.
* Whole works are far larger than needed: the sixteen works total ≈ 3.05 million characters and ≈ 580 000
  words. Shipping complete works would bloat the paid Android download for no benefit.

**The single most useful number: what to add next.** Measured over the shipped library, each additional
sound is worth this much token coverage at S2:

| Language | Base S2 | Best next sounds |
|---|---|---|
| German | 88.4 % | `+v` → +2.5 pp (90.8 %) · `+ü` → +2.3 pp · `+ä` → +2.1 pp · `+ö` → +1.7 pp · `+j` → +1.1 pp |
| English | 87.2 % | `+y` → **+8.2 pp** (95.4 %) · `+v` → +2.5 pp (89.7 %) · then `j q x z` below +0.5 pp each |

`y` is by far the highest-leverage English sound because it unlocks *you, they, very, my, any, every*.
German has no single dominant gap; `v` and the three umlauts each add two to three points. This table is
the data behind F2.4 and should be surfaced per book, not only per language.

### 5.6 Excerpting is deferred (this drop ships complete works)

**Decision D4: every work ships complete.** The converter takes the whole EPUB. There is no curation
step in this plan, nothing is dropped, and no issue may wait on a human editorial choice.

Consequences:

1. The whole work is converted, including its own front and back matter after the extraction rules of
   F5.5 (chapter lists, dedications and similar are ordinary paragraphs, not errors).
2. The reader's sentence filter (F3.5) and per-word roles (F3.2) are what make a complete work usable for
   a six-year-old, because only a minority of sentences in a long work need no adult word (§5.5).
3. Size is managed by the compact model in F6.1 (implicit positional ids, no per-sentence objects), not
   by dropping text.
4. *Der Struwwelpeter*'s content note stays in the manifest and in the credits; shipping complete means
   the note matters more, not less.

**If excerpting is wanted later** it is a separate, human-run editorial pass with its own requirements:
choose coherent passages (whole fable, verse or scene), keep ≥ 2 sentences with zero adult words per
book, preserve verse lines, and record the source anchor per excerpt. It is explicitly **not** part of
this plan, and the converter must not grow a heuristic that guesses excerpts.

---

## 6. Coverage metric — exact definition

### 6.1 Algorithm

For a text `T`, a language `L`, and a selection `S = (consonants, vowels, specials)`:

1. Split `T` into word tokens with `/[A-Za-zÀ-ÖØ-öø-ÿĀ-ž]+/g` on the raw text. Everything else
   (spaces, punctuation, digits, symbols) is a separator and is not counted. Hyphens and apostrophes
   separate words, so `Schaukel-pferd` counts as two words and `don't` as two.
2. Lowercase each token (matching the app's existing behaviour).
3. Tokenize with `tokenizeWord(token, allSpecials(L))`, where `allSpecials` is the complete special list
   of the language, so digraphs and doubled letters are recognized even when not selected.
4. Token is **readable** iff every unit is in `consonants ∪ vowels ∪ specials`, with the existing `xx`
   rule: a two-character unit of identical letters counts as allowed when `xx` is selected.
5. **Token coverage** = readable tokens ÷ all tokens. **Type coverage** = readable distinct
   lowercased tokens ÷ all distinct lowercased tokens.
6. No word-length cap is applied. Words Mode's `maxLength` is a deck-building limit and must not leak
   into coverage.
7. Per-sentence profile: for each sentence, the number of tokens that are not readable; a sentence with
   0 is "fully readable".

The implementation is a pure function in a browser-independent module, unit-tested, and reused by the
web app, the Android bundle and the build tool.

### 6.2 Rounding and display

* Store full precision in the manifest; display `Math.round` with no decimal place.
* Prefix with `≈` and label "theoretisch", because readability of a word does not imply comprehension.
* Show `100 %` only at exactly 100 %.

### 6.3 Invariants

* Adding any sound to `S` never decreases coverage (monotonic).
* Coverage is independent of word order and of sentence boundaries.
* Coverage of an empty selection is 0; and `S3` (every sound) is exactly 100.0 % on every shipped book.
* Selecting `xx` changes coverage only for words containing doubled letters.

### 6.4 Interaction with the existing tokenizer (important)

`tokenizeWord` matches a multi-character special **greedily and unconditionally**, even when that
special is not selected. Consequences that look like bugs but are intentional and must be preserved:

* `auf` tokenizes as `['au', 'f']`, so it is an adult word at every selection that lacks `au` — even
  though a child who knows `a`, `u`, `f` can sound it out.
* `said` tokenizes as `['s', 'ai', 'd']` and `you` as `['y', 'ou']`, so the most frequent words in
  children's fiction become adult words whenever the digraph is unselected.
* `könig` tokenizes as `['k', 'ö', 'n', 'i', 'g']` and is adult until `ö` is selected, because the
  umlaut is a special, not a letter.

This is exactly how Words Mode already counts and builds decks, so coverage and Words Mode agree by
construction. The requirements therefore **do not change the tokenizer**; instead they make the effect
visible (F2.4: "add `au` to unlock auf, auch, aus") and testable (§6.3, F6.5). Any future change to
make segmentation selection-aware would change every number in §5 and needs its own requirements item.

---

## 7. Data formats and integration

### 7.1 Files

```
sites/lesen/books-src/<bookId>.epub          # COMMITTED inputs, 16 files, 9.23 MB (see below)
sites/lesen/books-src/sources.json           # per book: metadata, PD basis, sha256, bytes, plates flag
sites/lesen/books-src/README.md              # provenance and how each file was obtained
sites/lesen/tools/epub.mjs                   # build-time importer: ZIP + OPF + spine -> canonical book
sites/lesen/static/books.mjs                 # pure: manifest access, coverage, sentence profile
sites/lesen/static/reader.mjs                # pure: paragraph/sentence/word-role view model
sites/lesen/static/books/manifest.json       # bundled books, provenance, coverage
sites/lesen/static/books/de/<bookId>.json    # canonical model, generated by epub.mjs
sites/lesen/static/books/en/<bookId>.json
sites/lesen/static/books/<bookId>/<image>    # re-encoded plates, only for illustrated books
sites/lesen/static/books/README.md           # extraction and curation rules
sites/lesen/tools/build_books.mjs            # runs tools/epub.mjs over books-src + --check (no fixtures needed)
sites/lesen/tests/epub.test.mjs              # imports ../tools/epub.mjs
sites/lesen/tests/books.test.mjs
```

**The sixteen source EPUBs are committed under `sites/lesen/books-src/`** (9.23 MB total), together
with `sources.json` and a provenance README. They are inputs, not app content: the directory is outside
`static/`, so `scripts/copy-assets.mjs` never copies it into `www/` and it never reaches the Android
bundle or the website.

* Fifteen books are the Project Gutenberg `.noimages` EPUB (0.07–0.53 MB each), because F5.6 ships plates
  only for *Der Struwwelpeter*, whose illustrator is its author (Hoffmann, d. 1894). That book is
  committed as the illustrated `.epub.images` (4.09 MB, 32 images).
* A `.noimages` EPUB still contains exactly one image, the Gutenberg cover. `sources.json` marks those
  books `images.plates: false`; conversion must not ship the cover.
* `de-fuenfzig-fabeln.epub` is assembled from that work's 24 Wikisource fable pages, because the
  Wikisource exporter does not follow subpages. Its construction is documented in the books-src README.

Because the sources are committed, `build_books.mjs --check` re-derives the canonical JSON from the exact
bytes that ship, which is what makes the conversion auditable offline. Committed EPUB fixtures for the
parser tests are therefore unnecessary: the real sources are the fixtures.

### 7.2 Canonical book model and manifest

Canonical book file (what the importer emits):

```json
{
  "schemaVersion": 1,
  "id": "de-struwwelpeter",
  "lang": "de",
  "paragraphs": [
    { "id": "p1", "kind": "verse", "lines": 4,
      "sentences": [ { "id": "p1:s1", "text": "Sieh einmal, hier steht er, pfui!" } ],
      "images": ["illu-01"] },
    { "id": "p2", "kind": "prose",
      "sentences": [ { "id": "p2:s1", "text": "…" } ] }
  ],
  "images": [ { "id": "illu-01", "file": "books/de-struwwelpeter/illu-01.jpg",
                "sha256": "…", "width": 900, "height": 521,
                "alt": "Der Struwwelpeter mit langen Haaren und langen Nägeln.",
                "caption": null } ]
}
```

Manifest entry (bundled books only):

```json
{
  "schemaVersion": 1,
  "generated": "2026-10-29",
  "rules": { "euDeathYearBelow": 1956, "usPublicationYearAtMost": 1930, "validatedForYear": 2026 },
  "languages": {
    "de": { "books": [ {
      "id": "de-heinzelmaennchen", "title": "Die Heinzelmännchen", "author": "August Kopisch",
      "authorDeathYear": 1853, "firstPublicationYear": 1836,
      "translator": null, "illustrator": null, "illustratorDeathYear": null,
      "source": { "name": "Wikisource", "url": "https://de.wikisource.org/wiki/Die_Heinzelmännchen",
                  "edition": "Gedicht von 1836", "epubSha256": null },
      "licenseBasis": "PD-EU-70 / PD-US-public",
      "contentNote": null, "file": "books/de/de-heinzelmaennchen.json",
      "images": { "count": 0, "complete": true },
      "stats": { "words": 518, "types": 271, "sentences": 28, "paragraphs": 9, "chars": 3046,
                 "coverage": { "S0": 7.3, "S1": 51.7, "S2": 88.0, "S2_types": 80.4, "S3": 100.0 },
                 "sentences0Adult": 0.21, "sentencesMax2Adult": 0.57 }
    } ] },
    "en": { "books": [] }
  }
}
```

This manifest is the only source of books; the app ships no other way to add one.

### 7.3 Card identity (statistics)

```json
{
  "version": 2,
  "cards": {
    "w|Hut": { "kind": "word", "text": "Hut", "correct_count": 3, "incorrect_count": 1 },
    "s|de-haewelmann:p1:s1": { "kind": "sentence", "text": "Es war einmal …", "bookId": "de-haewelmann", "correct_count": 1, "incorrect_count": 0 }
  }
}
```

Same storage key as today: `buchstabenzeit:card-stats`.

### 7.4 Reading progress

```json
{ "de-heinzelmaennchen": { "paragraphId": "p3", "sentenceId": "p3:s4", "updatedAt": "2026-10-29T09:00:00Z" } }
```

Storage key: `buchstabenzeit:reading-progress`. One position per book, written implicitly as the child
reads. Independent of card statistics and of bookmarks; corrupt values are ignored.

### 7.5 Bookmarks

```json
{
  "version": 1,
  "books": {
    "de-struwwelpeter": [
      { "paragraphId": "p7", "sentenceId": "p7:s3", "createdAt": "2026-10-29T09:05:00Z" },
      { "paragraphId": "p12", "sentenceId": "p12:s1", "createdAt": "2026-10-29T09:31:00Z" }
    ]
  }
}
```

* Storage key: `buchabenzeit:bookmarks`. Versioned like card statistics; an unknown `version` is treated
  as empty rather than crashing.
* `paragraphId` duplicates the prefix of `sentenceId` but is stored so the list can group without parsing
  ids; both are validated on read and an inconsistent pair is dropped.
* The 50-per-book cap is enforced on write as well as on read, so a hand-edited or corrupted store cannot
  wedge the UI.
* Deleted separately from reading progress and from card statistics: clearing one must not clear the
  others.

### 7.6 Integration points

| Change | Location |
|---|---|
| Patterns radio + sub-checkboxes | `static/index.html` setup markup, `updatePatternControls`, `startDeck` |
| Deck building | `static/index.html` `startDeck` (use `buildCombinations` from `sounds.mjs`, delete the inline copy) |
| EPUB parsing (build time only) | new `tools/epub.mjs`, no dependencies, injected `inflate` |
| Coverage and profiles | new `static/books.mjs`, used by the picker, the reader and the build check |
| Reader view model | new `static/reader.mjs` |
| Statistics | `static/scoring.mjs` (card identity, kind-aware Flops), `static/storage.mjs` (v2 + migration) |
| Bookmarks and progress | `static/storage.mjs` (two new versioned keys), reader controls in `static/index.html` |
| Strings | `static/i18n.mjs` |
| Credits | about/legal dialog in `static/index.html` |
| Content | `static/books/**`, `tools/build_books.mjs` |
| Android | none; `scripts/copy-assets.mjs` already copies all of `static/`, and no new plugin or permission is needed for the file picker |

---

## 8. UX summary

### 8.1 Setup — "Geschichten" tab

```
[ DE ] [ EN ]                      ← existing language control
( Karten )  ( Geschichten )        ← new tabs, Karten keeps today's screen

Fünfzig Fabeln für Kinder   ≈ 90 % lesbar
Wilhelm Hey, 1833           Ø 1,4 Erwachsenen-Wörter pro Satz
Fabeln · leicht             81 % der Sätze ganz ohne Erwachsenen-Wort
                            Weiter bei Satz 12 · ⚑ 2 Lesezeichen     [ Lesen ]

Die Heinzelmännchen         ≈ 88 % lesbar
August Kopisch, 1836        Ø 2,2 Erwachsenen-Wörter pro Satz
Gedicht · leicht            Noch nicht begonnen                      [ Lesen ]
```

* The coverage chip opens the explanation panel (F2.4).
* A book row without progress shows "Noch nicht begonnen".
* The bookmark count (F3.7) opens the bookmark list; it is omitted when there are none, so the row does
  not grow for every book.

### 8.2 Reader

```
← Bücher               Die Heinzelmännchen            Satz 2 / 28 · 7 %

   Wie war zu Cölln es doch vordem,
 ▸ Mit Heinzelmännchen so bequem!                        ⚑

   Du liest: 3 von 4 Wörtern · Erwachsener liest: Heinzelmännchen, bequem

      [ Zurück ]  [ Satz hören ]  [ ⚑ Merken ]  [ Als Karte ]  [ Weiter ]
```

* Current sentence at full contrast; neighbouring sentences of the same paragraph dimmed but present.
* Adult words: lower contrast plus a dotted underline; legend above.
* Tapping an adult word opens the word panel (missing sounds + speaker).
* Verse paragraphs keep their line breaks.
* The bookmark control is a toggle: "⚑ Merken" becomes "⚑ Gemerkt" with `aria-pressed="true"`, and the
  marked sentence shows the margin flag shown above. On a narrow screen the control row wraps rather
  than shrinking the targets below 44 px.

### 8.3 Collected sentence card

* Practice screen shows the sentence with the same word marking.
* Existing "Richtig gelesen" and retry buttons; no new interaction.

---

## 9. Owner decisions

| # | Decision | Status |
|---|---|---|
| 1 | Book list (§5) | **Decided 2026-10-29** — eight German, eight English works as listed, including *Der Struwwelpeter* |
| 2 | Content notes / sensitive titles | **Decided 2026-10-29** — *Struwwelpeter* ships with its imagery and its content note; *Max und Moritz* stays out |
| 3 | Reading interaction | **Decided 2026-10-29** — child reads aloud, adult marks, no typing input |
| 4 | Percentage semantics | **Decided 2026-10-29** — running-text share primary, distinct-words share secondary |
| 5 | "Geschichten" tab instead of a fifth pattern radio | **Decided 2026-10-29** — confirmed |
| 6 | Default sentence filter "at most 2 adult words" | **Decided 2026-10-29** — confirmed |
| 7 | How the book texts enter the repository | **Done 2026-10-29** — sources committed per §9.1 |
| 8 | Book count parity (8 + 8) | **Decided 2026-10-29** — German topped up with *Der Struwwelpeter* |

### 9.1 How books enter the app (answer to question 5, revised 2026-10-29)

**There is no bespoke "import the texts" step.** The original plan would have committed sixteen
hand-normalized `.txt` trees plus a provenance file, which is fragile: it fights boilerplate, page
markers and verse wrapping with regex. That plan is withdrawn in favour of EPUB as the input format.

Today there is exactly one way a book becomes app content: **the build-time EPUB importer (F5.1)**.

| Step | Who | Input | Output |
|---|---|---|---|
| Conversion | a developer, before committing | a public-domain EPUB | canonical JSON in `static/books/`, plus optimized images |

A test asserts that a committed book equals a fresh conversion, so the committed files cannot silently
diverge from their sources.

Consequences for the work itself:

* No `sources/*.txt` tree, no `sources.json`, no hand-written text and no regex scrubbing of plain text.
  The boilerplate and verse problems disappear because structure comes from the EPUB.
* The plan needs **no human editorial step**: the book list and content notes are already decided (D6),
  complete works ship (D4), and alt text is generated (D15). Only code review remains.
* Adding a book later is one command and one committed JSON file.
* Nothing in the shipped app parses archives or decompresses: no ZIP code, no `DecompressionStream`, no
  WebView capability check, no version floor. This is the main simplification of dropping import.
* If import is ever wanted, `tools/epub.mjs` is already the parser, and its DEFLATE step is injected;
  the door is open without a rewrite, but nothing in this plan depends on it.

Verified before writing this in Node: a hand-rolled ZIP reader plus raw-DEFLATE inflation parses a real
Project Gutenberg EPUB 3 (`Der Struwwelpeter`, 44 entries, 32 images, 37 646 characters of text, 346
sentence ends) and detects DRM markers via `META-INF/encryption.xml`. In the build the inflation is
Node's `zlib.inflateRawSync`, so no decompression code needs to be written at all. The EPUB also carries
the **complete** plate set for that book, whereas the plain-text edition exposes only 8 images — one
more reason the EPUB is the right input.

If a harness issue needs a human mid-run, it raises a human task, answered with the trusted local
command or the dashboard:

```bash
harness tasks
harness respond <task-id> --answer option=1
harness sync-tasks
harness gui
```

### 9.2 German topped up: 8 + 8

*Der Struwwelpeter* joins the German list, which resolves the earlier 7-vs-8 gap and makes German and
English symmetrical. It is the easiest German work measured (89.6 % at S2, 32 % of sentences with no
adult word, 74 % with at most two) and the only illustrated book in this drop.

Still on the bench, measured on the same basis, if a later drop wants more German: *Ludwig Bechsteins
Märchenbuch* (88.7 %, 12 % of sentences with no adult word) and *Max und Moritz* (85.2 %, 17 %).

### 9.3 Status

All owner decisions are settled. The scope is now deliberately narrow: a fixed library of sixteen
public-domain books, converted from EPUB at build time, plus the reading and card modes. **Book import
is out of scope** (dropped 2026-10-29 as too complex for this plan); the importer stays a build-time
tool, so nothing in the shipped app parses archives or decompresses anything.

Suggested order for the harness phases, respecting real dependencies:

1. `tools/epub.mjs` (F5.1) — pure, no dependencies, DEFLATE injected, tested against committed EPUB
   fixtures.
2. Canonical model + conversion of the sixteen books (F5.2, F5.3, F5.5, F5.6).
3. Coverage, picker and reader (F2.2–F2.5, F3.1–F3.6) — now testable against real books.
4. Resume and bookmarks (F3.4, F3.7) — small, but they share the stable sentence ids, so they land right
   after the reader works.
5. Cards (F4.1, F4.2) and credits (F5.4).
6. Patterns (F1.1–F1.3) are independent and can run in parallel from the start.

There is no human editorial step left: the book list, the content notes and the complete-work decision
are settled, and alt text is generated (D15). The run is autonomous from step 1 onward.

## 10. Non-goals

* No typing, writing or spelling input, no voice recognition, no automatic pronunciation scoring.
* No bundled audio recordings, no speech model, no online speech service (unchanged from
  `ANDROID-PLAN.md`).
* No accounts, sync, telemetry or cloud storage.
* No modern or in-copyright children's literature; no licensed translations.
* No new illustrations; only public-domain plates that pass the same rights test as the text, and no
  commissioned artwork.
* No modernization of historical spelling or vocabulary.
* No change to the German word list, including its deliberate exclusion of English-origin words.
* No comprehension quizzes; the percentage is a decoding estimate, not a reading test.
* **No book import in the app.** No EPUB, PDF, MOBI, AZW, DOCX or plain-text import, no file picker and
  no on-device book storage. The importer is a build-time tool and the library is fixed per release.
* No DRM circumvention anywhere in the pipeline: an encrypted EPUB is refused by the build, and the app
  never contains decrypting code.
* No cloud library and no reading-list sync between devices.
* No languages other than German and English in the bundled library.

## 11. Validation

```
cd sites/lesen && node --test tests/*.test.mjs
python3 -m unittest discover -s sites/lesen/tools -p "test_*.py" -v
cd sites/lesen && node tools/build_books.mjs --check
```

Manual checks (documented in the PR with screenshots):

1. Offline (flight mode) start, book open, sentence advance, collected sentence practice.
2. 320 px width, 200 % text zoom, greyscale.
3. TTS unavailable and TTS without a matching offline voice.
4. Patterns: `ma` only == old `CV`, `am` only == old `VC`, all four selected, none selected.
5. *Der Struwwelpeter* shows its plates, *Die Heinzelmännchen* has no image area at all.
6. Run `build_books.mjs --check` after deleting one committed book JSON: the check fails with a message
   naming the missing book.
7. Mark two sentences, close the app, reopen the book, jump from the bookmark list to each one; then
   filter to "0 Erwachsenen-Wörter" and jump to a bookmark that the filter would hide.

## 12. Risks

| Risk | Mitigation |
|---|---|
| Archaic 19th-century German makes many words adult words | Curate passages, show missing sounds, keep the percentage honest |
| Greedy digraph matching makes common function words look adult (`auf`, `you`, `said`), which can confuse a parent | §6.4 documents it as intended; F2.4 names the sound to add (e.g. `+y` is worth +8 pp in English) |
| Fairy-tale violence or dated language | Content notes, excerpt selection, owner approval (§9) |
| Public-domain status differs by country, especially translations and illustrations | PD gate in the build (F5.3), German-original preference, illustrations only when the illustrator also passes |
| Book-level percentage looks good while sentences are unreadable | Sentence profile, filter (F3.5), per-sentence word roles |
| Content size in the paid Android app | Curated excerpts, per-language budget, lazy loading, canonical JSON instead of committed EPUBs |
| Tokenizer drift or a stale commit silently changes every percentage | Golden coverage fixture pins the numbers; `build_books.mjs --check` re-converts from the EPUBs and fails on any difference |
| Statistics migration loses a child's history | Idempotent v1→v2 migration with exact counter preservation and tests |
| A re-converted book invalidates stored bookmarks | Anchor on stable sentence ids; stale entries shown as "nicht mehr verfügbar" with delete, never as an error; the book always opens |
| Scope creep into a full e-book reader | Non-goals; reader is sentence-focused, not paginated |

---

## Appendix A: measurement method

The numbers in §5.3 and §5.4 were produced on 2026-10-29 with a throwaway script that reused
`sites/lesen/static/sounds.mjs` (`tokenizeWord`, `getSoundsForLanguage`):

1. Sources: Project Gutenberg plain text for 13 works; German Wikisource for *Fünfzig Fabeln für
   Kinder* (24 fable subpages), *Münchhausen* and *Die Heinzelmännchen*. Four further Gutenberg texts
   were measured as alternates but are not in the shipped list.
2. Removal of Gutenberg header/footer and Wikisource navigation/metadata, soft hyphens and line-break
   hyphenation, then whitespace collapse.
3. Tokenization and classification exactly as in §6.1 with the reference selections of §5.2.
4. Sentence splitting only for the profile columns, using a punctuation + capital-letter heuristic.

Two caveats, both deliberate:

* **Plain text was measured, EPUBs will ship.** The plain-text measure was chosen because it lets the
  numbers describe the *work*, not an edition, and it is the honest way to compare candidate books. The
  bundled files are produced from EPUBs by F5.1, so the manifest's per-book counts will differ slightly
  from this table (boilerplate removed structurally, verse detected differently).
* Whole-work measurements are used here so the choice of text is not flattered by curation. The
  manifest recomputes everything for the curated excerpts.

For *Der Struwwelpeter* the EPUB was additionally parsed end to end as a feasibility check: 44 ZIP
entries, 32 images in the manifest, 37 646 characters of extracted text and 346 sentence ends, with no
DRM markers present.
