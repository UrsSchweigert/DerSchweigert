# Buchstabenzeit — marketing copy (English)

Based on the approved listing drafts in `sites/lesen/docs/store-listing.md` and
the copy on `lesen.derschweigert.de`. Every claim is verifiable in the product;
the heading limits are the store limits and the trailing numbers are the actual
lengths.

**Status:** the app is not published yet. This text is ready to submit but does
not claim an existing store presence. Price tier, contact URLs and the submission
itself remain owner decisions. The App Store listing for v1 is German only; this
English text is for Google Play (which supports per-language listings) and for a
later App Store localisation.

## App Store Connect

| Field | Limit | Value | Chars |
| --- | --- | --- | --- |
| Name | 30 | Buchstabenzeit | 13 |
| Subtitle | 30 | Reading practice, card by card | 30 |
| Promotional text | 170 | Letters, syllables, words: an adult picks the cards, the child reads — offline, no account, no ads. Buy once and keep it. | 121 |
| Keywords | 100 | reading,letters,syllables,words,learn to read,phonics,primary school,offline | 76 |

### Description (4000 max)

```
Small steps in learning to read: an adult picks letters and reading cards, sits alongside the child and marks each answer. Syllables, words and short sentences — at the child's own pace, in German or English.

WHAT THE APP DOES
• Pick consonants, vowels and special sounds such as "sch", "ei" or "au" and build a card deck from them
• Four modes: syllable patterns (ma, am, mam, ama), whole words, sentences, and a repeat mode for cards that came back
• A star marks the letter that unlocks the most new words next
• Card count is yours to choose; large "Practice more" and "Read correctly" buttons; progress bar throughout
• Completion screen with a summary and a new round on request

BUILT FOR PARENTS
The report stays on the device: cards practised, correct and retried cards, accuracy and practice time — as a table in the app and as a CSV you can hand on through the system share sheet. Nothing is uploaded.

OFFLINE, NO ACCOUNT
After installation the reading exercises work fully offline. There is no account, no sign-in, no advertising, no analytics and no tracking.

OPTIONAL READ-ALOUD
The app can read a card aloud. That needs a suitable German or English voice already installed on the device, and not every device has one. Without it, practice continues without sound — there is no network-voice fallback.

REMINDERS BY CHOICE
One optional daily local notification can remind you to practise. It is off by default and can only be enabled after an adult multiplication challenge. No notification permission is requested without that opt-in.

FEEDBACK YOU CAN FEEL
Correct and retried cards feel different. When the system's Reduce Motion setting is on, the haptic feedback is suppressed.

BUY ONCE
One purchase per store account, no subscription, no in-app purchase, no renewal. The reading exercises are also available for free in the browser at lesen.derschweigert.de — the app adds installation for on the go and native device features. Installation and payment still go through the store.

LANGUAGES
German and English, switchable at any time with the flag buttons.
```

## Google Play

| Field | Limit | Value | Chars |
| --- | --- | --- | --- |
| App name | 30 | Buchstabenzeit | 13 |
| Short description | 80 | Guided reading practice with letters, syllables and words — offline. | 68 |

### Feature graphic and app icon

Both are rendered from the app's artwork (`sites/lesen/store-art/`, see its
README) and carry this text:

| Image | Text | Alt text (140 max) |
| --- | --- | --- |
| Feature graphic 1024 × 500 | **Letter time** / guided reading | The owl in blue glasses and a small yellow fledgling read an open book together, with alphabet blocks floating beside them. |
| App icon 512 × 512 | no text — just the owl with the book on the blue rays | App icon: the face of the owl in blue glasses against blue rays, an open book held in its wings. |

The English listing name above is `Buchstabenzeit`; the English feature graphic
says *Letter time*. Align the two before submitting by editing
`FEATURE_GRAPHIC_COPY` in `store-art/tools/compose.py` and re-running it.

### Full description (4000 max)

Use the App Store description above unchanged — Play has the same 4000-character
limit and the same review rules for an app with no ads and no data collection.

## Screenshot captions

The screenshots carry no baked-in text, so both stores accept them and they stay
readable in every language. Use these captions on the website, in store gallery
descriptions and in social posts.

| File | Caption | Alt text |
| --- | --- | --- |
| `01-setup` | Pick the letters, read the cards | Selection screen: consonants, vowels and special sounds as tiles next to the card modes. |
| `02-card-syllable` | Syllables, one step at a time | Reading card showing the syllable ›ma‹ with a progress bar, the read-aloud button and the ›Practice more‹ and ›Read correctly‹ actions. |
| `03-card-word` | From syllable to whole word | Reading card showing a whole word in large type with the round's progress. |
| `04-complete` | All cards done | Completion screen with a check mark, stars and a summary of the cards read. |
| `05-report` | Parent report, on the device | Report dialog with cards practised, accuracy and a per-card table next to ›Export as CSV‹. |

Store order: setup → syllable → word → complete → report. It follows the flow a
child actually experiences. If only three fit, use setup, syllable and report.

## Social

One-liner:

> Reading practice, card by card — together, offline and without an account.

Short post (X / Mastodon):

> Buchstabenzeit: an adult picks the letters and reading cards, the child reads — syllables, words, short sentences. Offline, no account, no ads. The report stays on the device. Buy once, no subscription. Free in the browser: lesen.derschweigert.de

Instagram / Facebook:

> One letter, one card, one small moment.
>
> Buchstabenzeit is guided reading practice: you pick the letters, the child reads the card, you tap "Read correctly" or "Practice more". Syllables like "ma", whole words and short sentences — in German or English.
>
> • Four card modes, card count up to you
> • Works offline, no account and no advertising
> • Parent report as a table and as CSV — nothing is uploaded
> • Optional read-aloud with a voice already installed on the device
>
> Buy once, no subscription. The exercises are also free in the browser.

Hashtags: `#Buchstabenzeit #LearnToRead #ReadingPractice #EarlyLiteracy #KidsApp #Edutainment #OfflineLearning`

## Press

Boilerplate:

> Buchstabenzeit is guided reading practice for children: an adult chooses
> letters and reading cards, the child reads syllables, words and short
> sentences, and the answers are marked with two large buttons. The app works
> offline, with no account, no advertising and no tracking; progress stays on the
> device and can be shared as a CSV report. Buchstabenzeit ships as a one-time
> purchase for iPhone, iPad and Android, while the exercises remain free in the
> browser at lesen.derschweigert.de.

Fact sheet:

| Item | Value |
| --- | --- |
| Platforms | iPhone/iPad (App Store), Android (Google Play), free browser version |
| Price | One-time purchase per store account; tier set in the store console |
| Modes | Syllable patterns, words, sentences, repeat |
| Languages | German, English (switchable) |
| Account | None |
| Offline | Yes, exercises and progress |
| Report | Table in the app, CSV via the system share sheet, no upload |
| Read-aloud | Optional, installed offline voices only |
| Reminders | Optional, off by default, behind an adult challenge |
| Ads / analytics / tracking | None |
| Website | https://lesen.derschweigert.de (free) |

## Screenshots in this pack

`app-store-6.1-portrait/` (1179 × 2556) for the App Store 6.1"/6.3" display, and
`google-play-9x16/` (1080 × 1920) for Play — Play only accepts ratios between
16:9 and 9:16, so the two sets are separate captures rather than one file cropped
twice. `web/` holds 1179 px and 600 px WebP versions for pages, press kits and
Open Graph cards.
