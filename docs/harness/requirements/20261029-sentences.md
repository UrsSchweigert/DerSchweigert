# Buchstabenzeit: Sätze/Phrases as sentence cards

Status: draft for owner approval
Date: 2026-10-29
Replaces: `20261029_books-and-reading.md` (the book library is dropped)

The reading practice gets one new mode. Instead of a library of public-domain books, the app
practises a fixed pool of 1000 German and 1000 English sentences as cards, in the existing card
engine. Content is already committed at `sites/lesen/static/sentences/{de,en}.json`; every sentence
is at most six words and carries the stage (S0-S3) in which all its words are readable plus the
sound units it needs. No text is written, fetched or imported by a worker.

| ID | Title | Phase | Description |
|---|---|---|---|
| **1.1** | **Readability module** | P1 | Pure module: units of a word, readable/missing units for a selection, coverage per selection, and the share of readable sentences in the pool. |
| **1.2** | **Golden coverage values** | P1 | Hand-computed values pin the metric; a full selection reads every sentence, an empty one none. |
| **2.1** | **Sentence card mode** | P2 | The Karten tab offers sentence cards drawn from the pool, filtered to sentences the current selection can read. |
| **2.2** | **Sentence progress** | P2 | Attempts on sentence cards are stored, counted and survive a reload like word cards do. |
| **3.1** | **Sentence decks** | P3 | A sentence-only deck and a mixed deck that interleaves word and sentence cards. |
| **3.2** | **Sentence flops** | P3 | Flop decks include sentence cards and contain every weak card (no cap). |
| **4.1** | **Remove the book pipeline** | P4 | The EPUB importer, the licence gate and the committed book sources are deleted; nothing else depends on them. |
| **5.1** | **Both languages and accessibility** | P5 | Every new string exists in German and English and the new mode is operable with keyboard and screen reader. |
| **5.2** | **Regression guard** | P5 | The existing modes, word lists and statistics behave exactly as before. |
