# Third-party licences and attribution (P6 / requirement 6.3)

Audited baseline: `58b8951`. Scope is the shared web source in
`sites/lesen/static`, which the website and both Capacitor shells render, plus
the locked npm dependencies in `sites/lesen/package-lock.json`.

No dependency was added for this review. The licence notices below are the
ones already shipped; their wording is unchanged and must stay unchanged unless
an owner explicitly approves an attribution edit.

## Bundled content

### German word list — CC BY-SA 4.0

| Item | Value |
| --- | --- |
| Licence file | `static/words-de-LICENSE.txt` (full legal code included) |
| Bundled data | `static/words-de.json` |
| Licence | Creative Commons Attribution-ShareAlike 4.0 International (CC BY-SA 4.0) |
| Frequency source | Hermit Dave, FrequencyWords, German 2018 list, revision `525f9b5`, derived from OpenSubtitles2018 via OPUS |
| Spelling source | gambolputty/german-nouns, revision `da71a2b`, compiled from German Wiktionary |
| Changes | Recorded in the licence file ("Changes by the Buchstabenzeit project, 2026-10-20") |

Commercial redistribution is permitted. Obligations: keep the attribution and
the change record, link the licence, and license adaptations of the word list
under CC BY-SA 4.0 (ShareAlike).

### English word list — CC BY 4.0

| Item | Value |
| --- | --- |
| Licence file | `static/words-en-LICENSE.txt` (full legal code included) |
| Bundled data | `static/words-en.json` |
| Licence | Creative Commons Attribution 4.0 International (CC BY 4.0) |
| Frequency source | Hermit Dave, FrequencyWords, English 2018 list, revision `525f9b5`, derived from OpenSubtitles2018 via OPUS |
| Changes | Recorded in the licence file ("Changes by the Buchstabenzeit project, 2026-10-26") |

Commercial redistribution is permitted. Obligations: keep the attribution and
the change record and link the licence. This list is CC BY 4.0, **not**
ShareAlike; see "Known discrepancy" below.

### Andika font — SIL Open Font License 1.1

| Item | Value |
| --- | --- |
| Licence file | `static/fonts/OFL.txt` |
| Bundled fonts | `static/fonts/andika-latin-regular.woff2`, `static/fonts/andika-latin-bold.woff2` |
| Licence | SIL Open Font License 1.1 |
| Copyright | Copyright (c) 2004-2022 SIL International, with Reserved Font Names "Andika" and "SIL" |

Bundling, embedding and selling the font together with the app is allowed.
Obligations: keep the copyright and licence notice, do not sell the font on its
own, do not relicense it, and do not use the reserved names for a modified
version.

## Runtime dependencies

Versions are the resolved versions in `package-lock.json` (lockfile version 3);
`package.json` keeps caret ranges for some of them. All are bundled into the
native apps, so their notices must survive redistribution.

| Package | Version | Licence | Role |
| --- | --- | --- | --- |
| `@capacitor/core` | 8.6.0 | MIT | Web/native bridge |
| `@capacitor/android` | 8.6.0 | MIT | Android runtime |
| `@capacitor/ios` | 8.6.0 | MIT | iOS runtime (`capacitor-swift-pm` 8.6.0 via SPM) |
| `@capacitor/app` | 8.1.2 | MIT | App lifecycle, version, Back handler |
| `@capacitor/filesystem` | 8.1.5 | MIT | CSV report export |
| `@capacitor/haptics` | 8.0.2 | MIT | Grading feedback |
| `@capacitor/local-notifications` | 8.3.1 | MIT | Adult-gated practice reminders |
| `@capacitor/share` | 8.0.3 | MIT | Sharing the saved report |
| `@capacitor/synapse` | 1.0.4 | MIT (shipped notice; metadata says ISC) | Transitive dependency of `@capacitor/filesystem` |

MIT and ISC both permit commercial use, modification and redistribution and
require preservation of their copyright and permission notice. Installing npm
packages does **not** copy their root licence files into a Capacitor app.
The initial review inferred that incorrectly; inspecting the built `.app`
found only the word-list and font notices, not these runtime notices.

`static/third-party-notices.txt` now preserves the actual locked packages'
copyright and full permission/disclaimer texts. Identical notices are grouped:
core/android/ios (Drifty), app/haptics/local-notifications/share (Ionic
2020-present), filesystem/synapse (Ionic 2025). The original package `LICENSE`
files, or `LICENSE.md` for synapse, are the source. Synapse 1.0.4's metadata
declares ISC but its actual distributed notice is MIT; this record and the
bundle preserve that notice instead of inventing an ISC copyright notice.
No copyleft obligation applies to these runtime libraries.

## Build-only tooling

These are installed for local builds and CI but are not copied into `www/` or
into either native binary: `@capacitor/cli` 8.6.0 (MIT) and
`@capacitor/assets` 3.0.5 (MIT), together with their transitive tooling under
MIT, ISC, Apache-2.0, BSD-2-Clause/0BSD and BlueOak-1.0.0. They impose no
obligation on the distributed app; the same notices apply only if that tooling
itself is redistributed.

## Reachability from the about dialog

The about dialog in `static/index.html` (`#about-dialog`, "Inhalte & Lizenzen")
links `words-de-LICENSE.txt`, `fonts/OFL.txt` and `third-party-notices.txt`, and its language switch points
the word-list link at `words-en-LICENSE.txt` for English. Both native shells
render that same dialog because they bundle the same `static/` tree:

- Android: `npm run copy-assets` (`static/` → `www/`) then `cap sync android`.
- iOS: `npm run copy-assets` then `npx cap sync ios` (`www/` →
  `ios/App/App/public`).

The four licence files are part of `REQUIRED_FILES` in
`scripts/verify-bundle.mjs`, so `npm run copy-assets` (also the first step of
`npm run sync`) and `node --test tests/*.test.mjs` fail if a build drops one. `tests/android-shell.test.mjs`
already asserts that the about dialog links every bundled notice, and
`tests/third-party-licences.test.mjs` checks that each link target exists in the
bundle, preserves complete upstream notice texts and covers every runtime
dependency at its locked version. All notices are local files, so the links work offline; the bundle
check rejects any remote app-load dependency.

## Known discrepancy (owner decision)

The English about-dialog string (`dialog.about.wordlist` in `static/i18n.mjs`)
says "CC BY-SA 4.0", while `words-en.json` is licensed CC BY 4.0. The wording is
left untouched because this issue must not alter existing attribution wording;
correcting it is a separate owner-approved change to both the dialog text and
this record.

## Review outcome

Reviewed on 2026-11-04 for issue `lesen-licences`, with a corrective packaged
notice check after the P6 automated exit. Every runtime dependency and
bundled content licence is identified above; none blocks the one-time paid
distribution planned for v1, provided the notices stay bundled and reachable as
described. New dependencies must add a row here (with resolved version and
licence) before they ship.
