# Play Console app content: target audience, rating and data safety

These are the owner's declarations under **Play Console → Policy → App content**.
They are policy statements, not build output: no test can prove them, and Play
enforces misrepresentation in this section with removal or suspension. Any change
belongs here first, with the revision that made it.

**Decision (2026-11-12): the app targets ages 6 and up.** Target age groups
`6-8`, `9-12` and `13-14`. `5 and under` is deliberately *not* selected, and the
app is *not* declared 13+.

## Why 6+ and not 13+

- The app is a primary-school arithmetic game: cartoon art, level unlocks, a
  parental gate, no account, no leaderboard, no ads. Play reviews the declaration
  against the app's own imagery and terminology, so declaring 13+ would be a
  misrepresentation risk.
- Every Families requirement is already met (see below). A 13+ declaration would
  spend that compliance work for nothing and forfeit Teacher Approved
  consideration, which only children-inclusive apps can be considered for.
- `5 and under` stays out because the game has game-over, timed questions and
  mistake corrections. Google's guidance for that band names game penalties and
  punishments as disqualifying.

## Order of operations

Play Console only unlocks "Target audience and content" once ads, app access and
the privacy policy are declared. Fill the App content page in this order:

1. **Ads** — declare.
2. **App access** — declare.
3. **Privacy policy** — paste the URL.
4. **Content rating** — IARC questionnaire.
5. **Target audience and content** — the age bands.
6. **Data safety** — the data types.

## Paste-ready answers

### Ads

**No.** The app ships no ad SDK and no advertising ID; see "What the 6+ audience
forbids". Because there are no ads, Play never asks about the Families
Self-Certified Ads SDK program or about a neutral age screen.

### App access

**All functionality in this app is available without restrictions.** There is no
login, account, redeem code or region gate. The app opens and plays without the
in-app purchase; the purchase unlocks levels 3-60.

### Privacy policy

`https://ffm.derschweigert.de/datenschutz-app.html`
(English twin: `https://ffm.derschweigert.de/datenschutz-app.en.html`)

That page describes the app only — no account, no analytics, no tracking — and is
kept in sync with the bundled `legal/privacy.*.html` by
`tests/app-privacy-public.test.mjs`. Do **not** submit `datenschutz.html`: that is
the website/account policy and it states an 18+ account age, which contradicts
this declaration. The app bundle no longer carries it either — `copy-assets`
excludes `datenschutz*.html`, `impressum*.html` and `terms*.html`, and
`bundle-check` fails if one reappears, so a reviewer can only reach the bundled
`legal/*.html` pages written for the app.

### Content rating (IARC)

The questionnaire wording changes between revisions; answer the topics below and
keep them consistent with the data-safety answers and the privacy page.

| Topic | Answer |
| --- | --- |
| Violence | Yes, **cartoon/fantasy** combat only. No realistic violence, blood, injury or weapons aimed at people. |
| Fear | None beyond a cartoon dragon/fiend opponent. |
| Sexuality, nudity, language, controlled substances, gambling | None. |
| Purchases | Yes: one one-time digital unlock (`arithmoslayer_full_unlock`). No virtual currency, no consumable, no random items. |
| User interaction | None. No chat, no profiles, no user content, no leaderboard inside the app. |
| Location | None. The app declares no location permission. |
| Internet access | The game is bundled and plays offline; the legal pages are bundled too. Contact links (`mailto:`) and the imprint open outside the app, behind the parental gate. |

Expected badge: USK 0 or 6, PEGI 3 or 7, ESRB Everyone. The badge is derived from
these answers, not chosen.

### Target audience and content

- **Target age**: `6-8`, `9-12`, `13-14`.
- **App details**: single-player, offline, no ads, no account, no user-generated
  content, no social features.
- **Ads follow-up**: not asked, because the app declares no ads.
- **Store presence**: opt in to Teacher Approved consideration (eligibility only,
  never a guarantee).

### Data safety

**No data collected, no data shared**, no tracking, no ads, no analytics. Progress
lives in Capacitor Preferences on the device and leaves it only through the OS
backup; see [BACKUP.md](BACKUP.md).

## What the 6+ audience forbids (Families Policy)

Any age band under 13 puts the app under the Families Policy Requirements. The
app already meets each of them:

| Requirement | How Arithmo Slayer meets it | Enforced by |
| --- | --- | --- |
| Only Families self-certified ad SDKs, no personalised ads, neutral age screen for mixed audiences | No ads at all | `package.json` has no ad dependency |
| No advertising ID or other persistent identifier transmission | No AD_ID, no analytics SDK. The merged manifest adds only `BILLING`, `INTERNET`, `ACCESS_NETWORK_STATE` from Play Billing | `android/app/src/main/AndroidManifest.xml` declares no permissions |
| Privacy policy on the listing and accurate data safety | Public app policy plus bundled `legal/privacy.*.html` | `tests/app-privacy-public.test.mjs` |
| App content appropriate for children, no account terms in the product | Only `legal/*.html` ships; the website's 18+ account pages are excluded and guarded | `FORBIDDEN_FILES` and the `legal/` entries in `BUNDLE_FILES`, `scripts/bundle-check.mjs` |
| No direct user-to-user interaction or user content | Leaderboard, accounts, checkout and auth UI are absent from the bundle | `FORBIDDEN_UI_IDS` in `scripts/bundle-check.mjs`, `EXCLUDED` in `scripts/copy-assets.mjs` |
| Purchases and external links behind a parental gate, no manipulative monetisation | `game/parental-gate.js` asks for the product of two operands spelled out in words between 6 and 12; prices come from the store, never hard-coded | `tests/purchase.test.mjs`, `tests/parental-gate.test.mjs` |

**This is the constraint to remember when adding features.** Accounts, a server
leaderboard, user content, ads, analytics or an advertising ID cannot be added
while this declaration stands. Bringing any of them into the app means raising the
target audience to 13+ in the same release, which reopens the questionnaire and
the Families review.

## When the declaration takes effect

- Saving starts a policy review (extended reviews can take up to 7 days). The
  public listing only changes with the next `versionCode` upload.
- Changing the audience later needs an app update, and Play recommends announcing
  the change in "What's new".
- iOS is a separate questionnaire: Apple maps "infrequent/mild cartoon or fantasy
  violence" to 9+, so the App Store can show a higher minimum age than Play for
  the same build. That divergence is expected; do not bend the answers to match.

## Owner actions

1. Declare ads, app access and the privacy policy for `de.derschweigert.arithmoslayer`.
2. Complete the IARC questionnaire with the answers above and confirm the badge.
3. Select `6-8`, `9-12`, `13-14` and save the target audience.
4. Fill Data safety as "no data collected" and confirm it matches the app policy page.
5. Upload a bundle so the declarations appear on the listing.
6. Verify the public listing shows the app's own policy URL, the expected rating
   and no ads, then record the revision.
