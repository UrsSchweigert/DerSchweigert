# Third-party licences and attribution (P6 / requirement 6.3)

Audited baseline: `58b8951`. Scope is the shared web source in
`sites/lesen/static`, which the website and both Capacitor shells render, plus
the locked npm dependencies in `sites/lesen/package-lock.json`. The corrective
exit review also resolves Android `debugRuntimeClasspath` and the actual Swift
package checkouts, rather than assuming npm is the entire native runtime.

No dependency was added for this review. Existing word-list/font attribution
wording is unchanged. Missing runtime notices are now included verbatim; this
is preservation of upstream licences, not a change to content attribution.

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

### Native dependencies beyond npm

The first corrected APK inspection also found that the npm list alone was
incomplete: Gradle embeds AndroidX, Cordova and Kotlin code, and npm's filesystem
plugin links separate native Ionic libraries. No root licence or NOTICE file
was discoverable in that APK. These components are now covered in the **same**
offline `third-party-notices.txt`; no extra dependency or runtime module is
introduced.

| Component | Resolved version | Licence and source |
| --- | --- | --- |
| `io.ionic.libs:ionfilesystem-android` | 1.1.1 | MIT, [versioned LICENSE](https://github.com/ionic-team/ion-android-filesystem/blob/1.1.1/LICENSE), identical Ionic 2025 notice retained |
| `ion-ios-filesystem` | 2.0.1 | MIT, [versioned LICENSE](https://github.com/ionic-team/ion-ios-filesystem/blob/2.0.1/LICENSE), same retained notice |
| AndroidX runtime/annotation families | Exact coordinates in the bundled notice | Apache-2.0, resolved POM declarations and embedded AAR `META-INF/androidx/**/LICENSE.txt` |
| `org.apache.cordova:framework` | 14.0.1 | Apache-2.0; [versioned NOTICE](https://github.com/apache/cordova-android/blob/rel/14.0.1/NOTICE) reproduced in full |
| Cordova compatibility sources in `capacitor-swift-pm` | Capacitor 8.6.0 | Apache-2.0 source notices; common full licence retained |
| `org.jetbrains.kotlin:kotlin-stdlib` | 2.2.20 | Apache-2.0, resolved Maven POM |
| `org.jetbrains.kotlinx:kotlinx-coroutines-*` | 1.10.2 | Apache-2.0, resolved Maven POMs; BOM/variant metadata identified separately from executable code |
| `org.jetbrains:annotations` | 23.0.0 | Apache-2.0, resolved Maven POM |
| `org.jspecify:jspecify` | 1.0.0 | Apache-2.0, resolved Maven POM |
| `com.google.guava:listenablefuture` | 1.0 | Apache-2.0, inherited licence in resolved `guava-parent:26.0-android` POM |

Apache-2.0 permits commercial binary redistribution, requires the full licence
and applicable upstream NOTICE text, and does not require opening the app's
own source. The complete [Apache-2.0 text](https://www.apache.org/licenses/LICENSE-2.0.txt)
and Cordova NOTICE are bundled, not merely linked remotely. The test fingerprints
the full upstream licence, including the appendix. The archive inspection of
the resolved runtime AARs/JARs found Apache licence copies in AndroidX archives
and no additional embedded NOTICE texts; source Cordova NOTICE is retained.

Reproduce the native inventory after `npm ci` and `cap sync android`:

```sh
cd android
./gradlew :app:dependencies --configuration debugRuntimeClasspath --console=plain
```

Check each selected coordinate's cached Maven POM (including inherited licence
metadata), applicable AAR/JAR notices, and the Swift checkout licences when
dependencies change. Compare against the exact coordinate list in the bundled
notice. Before release, inspect the actual APK's
`assets/public/third-party-notices.txt` and the built `.app`'s
`public/third-party-notices.txt`, not just `node_modules` or a successful copy.

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
