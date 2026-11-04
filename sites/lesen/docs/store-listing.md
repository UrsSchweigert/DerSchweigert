# Store listing drafts (P6 / requirement 6.2)

Draft-only material for a one-time paid release of Buchstabenzeit on Google
Play and the App Store. Nothing in this file has been published, priced in a
store console, or submitted for review. Exact price tiers, merchant details,
screenshots and submission are owner actions; see `../RELEASING.md` and
`../ios/RELEASING.md`.

## Pricing and distribution

- One-time paid purchase on **both** Google Play and the App Store. The user
  pays once per store account and keeps the installed app; there is no
  subscription, no in-app purchase, no purchase backend and no online licence
  check.
- No advertising, no analytics and no tracking SDKs ship with the app. The app
  has no account and no network feature.
- The Android package must be configured as paid **before** any public free
  distribution. Google does not allow converting an already free package into a
  paid download, so this ordering is a release prerequisite.
- Offline use after installation does not make installation and purchase
  independent of the store. A store account and the store's payment flow are
  still required to install the app.
- The price tier itself is deliberately not chosen here. It is an owner
  decision made in each store console, and this repository contains no pricing
  change.

## Website stays free

`lesen.derschweigert.de` remains free and continues to deploy independently of
both store apps. The paid apps sell the installed, offline-first convenience
and the native capabilities, not access to the learning content: the shared web
source in `static/` is the same source both the website and the app shells
render. Nothing about a store purchase removes or gates the website.

Listing copy should say this plainly, for example: "The reading exercises are
also available for free in the browser at lesen.derschweigert.de. The app is a
one-time paid download that adds offline installation and native device
features."

## App Store listing language

For v1 the App Store listing text (name, subtitle, description, keywords,
promotional text and review notes) is **German only**, even though the shipped
app is bilingual German/English. German is the default app language and the
DE/EN buttons switch the whole interface. The App Store Connect primary
language is therefore German, with no English localisation submitted in v1.
This is a v1 scope decision, not a platform limitation; later versions may add
localisations.

The Google Play listing may be bilingual (German and English) because Play
supports per-language listing entries; this draft does not require both to be
identical. The in-app experience stays bilingual on both stores either way.

## Offline vs. device speech

Two different claims must not be merged in listing text:

- **Reading exercises are always offline.** The web bundle ships inside the app
  (`capacitor.config.json` has no `server.url`), so setup, cards, grading,
  progress and the parent report work in airplane mode with no network.
- **Read-aloud is conditional on the device.** The optional native speech path
  uses the registered `OfflineTts` bridge with `AVSpeechSynthesizer` on iOS and
  the platform TTS engine on Android. It needs an installed, eligible German or
  English device voice and only enumerates offline-capable voices; there is no
  network-dependent fallback. Without a suitable voice the app explains the
  limitation and practice continues without audio. Read-aloud must not be
  promised on every device, and the listing must not imply that a missing voice
  blocks the exercises.

The website keeps its existing Web Speech path; the installed-voice constraint
described here applies to the app's native speech capability.

## Capabilities named for store review

Use these four names consistently, matching `../ios/APP-REVIEW.md`. File writing
and sharing are two parts of one report capability, not a substitute for
speech.

| # | Capability | What the listing may claim |
| --- | --- | --- |
| 1 | Native speech | Optional read-aloud through installed offline-capable DE/EN device voices (registered `OfflineTts` bridge; `AVSpeechSynthesizer` on iOS, platform TTS on Android). Not guaranteed on every device. |
| 2 | Local progress and parent report | Progress stays in the app container. The report capability writes `buchstabenzeit-report.csv` locally and opens the system share sheet; file write and share are one capability. Nothing is uploaded. |
| 3 | Adult-gated, default-off local reminders | One optional daily local notification, off by default, behind an adult multiplication challenge; only explicit opt-in requests permission. No server, push service or account. |
| 4 | Reduce-Motion-aware grading haptics | Distinct success and retry haptics for grading, suppressed when the system Reduce Motion setting is on. Physical-device behaviour. |

## Not performed here

This file is a draft only. No store listing, price, merchant setting, privacy
declaration or production configuration was changed, and nothing was submitted
to Google Play or App Store Connect. Producing signed builds, capturing
screenshots, running the device checks and publishing remain owner actions.

## See also

- `../RELEASING.md` — Android release process, paid-package ordering and shared
  plugin prerequisites.
- `../ios/RELEASING.md` — iOS release process and TestFlight gates.
- `../ios/APP-REVIEW.md` — App Review package, airplane-mode demo and the four
  native capabilities.
- `accessibility-audit.md` — accessibility pass and pending device gates.
