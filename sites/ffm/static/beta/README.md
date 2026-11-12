# `/beta/` — open-beta invite page

One static page that invites visitors into the Arithmo Slayer open beta: what
it is, how each platform's procedure works step by step, and the buttons and
form that start the join flow. Like `/promo/` it is plain HTML + CSS + one ES
module: no build step, no dependencies other than the store links the visitor
clicks and the same-origin waitlist endpoint.

| File | Purpose |
| --- | --- |
| `index.html` | The page. Ships **German**; every translatable string carries a `data-i18n*` key. |
| `beta.css` | Only what is unique to this page: shorter hero, requirements strip, beta tracks, step grid, waitlist form, art gallery. |
| `beta.js` | The page dictionary, the `#beta-lang-toggle` wiring and the waitlist form submit. |
| `beta.test.js` | `node:test` regression suite (see below). |

Tokens, buttons, the header, the hero stage, the section rhythm, the FAQ
accordion and the footer all come from `/promo/promo.css`, which this page
loads first. `beta.css` deliberately defines none of them: a second copy would
let the two pages drift apart, and `beta.test.js` fails if one appears.

## Preview locally

Serve the static root (not the `beta/` folder — every asset is referenced
root-relative and the page loads `/promo/promo.css` + `/beta/beta.js`):

```sh
cd sites/ffm/static
python3 -m http.server 8765
# then open http://127.0.0.1:8765/beta/index.html
```

The waitlist form needs the API. Run the Flask app with `FLASK_ENV=production`
(or any environment whose `DYNAMODB_USERS_TABLE` exists in DynamoDB) and open
the page through that origin, or mock the endpoint. Everything else works from
the plain static server, including the language toggle.

In production the CloudFront viewer-request function
(`infra/terraform/sites/ffm/cloudfront/landing-rewrite.js`) rewrites `/beta`
and `/beta/` to `/beta/index.html` without changing the browser URL, and
`/api/beta/android-waitlist` reaches the Flask app through the API origin.
That is why **nothing** may be a bare relative path: `beta.css` would resolve
to `/beta.css` at `/beta` and to `/beta/beta.css` at `/beta/`.
`beta.test.js` fails on any `src`/`href` that is not root-absolute,
`https://arithmoslayer.de/…`, one of the two allow-listed Apple links, an API
route, or a `#anchor`.

## What the page shows

| Section | Anchor | Content |
| --- | --- | --- |
| Hero | — | Kicker, logo, headline, the live TestFlight button, the Android waitlist link and the title-screen phone mockup. |
| Requirements | — | Three centred facts under the hero: iOS 15, the free TestFlight app, free of charge without an account. |
| iOS track | `#ios` | "Open now": facts, then four steps (install TestFlight → accept the invitation → install and play → send feedback), the 90-day note, the free-unlock note and the invitation button. |
| Android track | `#android` | "In preparation": facts, then four steps (enter the Google address → wait for the invitation → join and install → send feedback), the waitlist form, and the promo-code note. |
| Art | — | Three lazy-loaded promo stills (`art/action/fight`, `art/acts/act-3`, `art/action/lightning`) with captions. |
| FAQ / footer | `#faq` | Eight questions, legal links and the support address. |

## The two store paths

The iOS invitation is the real public TestFlight link
`https://testflight.apple.com/join/66sUYcn3`, used three times: the hero
button, step 2 and the iOS track footer. Android has no test track yet, so the
page never invents a Play Store URL: it explains the state and collects the
Google address instead.

When the Android track opens, replace the waitlist form with the real Play
opt-in link and update `beta.test.js` — the "Android is never presented as
released" test is the guard that makes this a deliberate change. When the
TestFlight link is rotated, update all three occurrences; the test counts them.

## The waitlist form

`POST /api/beta/android-waitlist` (app/beta_waitlist.py) stores the address
under `BETAWAITLIST#<address>` in the `ffm-users` table, lower-cased, together
with the submission time, the locale and the `web-beta-page` source marker.
Only **Gmail and Googlemail** addresses are accepted (`google_mail_required`
otherwise): Play's test track only invites Google accounts, and those two
domains are the only ones guaranteed to be one, so no tester waits for an
invitation Google will never send.
The endpoint is anonymous, so it validates strictly, rate-limits per source IP
(`BETA_WAITLIST_RATE_LIMIT`, `5/minute`) and is idempotent: a repeat sign-up
answers `200` with `already_registered` instead of writing a second item.

`beta.js` submits with `fetch`, disables the button while the request runs and
writes the outcome into the `role="status"` region for all five failure
classes (400 malformed, 400 non-Gmail/Googlemail, 429 rate limit, network
failure, unexpected status). A language switch re-renders that message instead
of leaving the old language in place. Without JavaScript the form's `action`
still names the API and the form carries a mailto fallback.

The owner reads the list with (from the repository root, using AWS credentials
that can read the production table — `DYNAMODB_USERS_TABLE` defaults to
`ffm-users`, the region comes from `AWS_REGION`/your profile):

```sh
python -m flask --app sites.ffm.app:create_app beta-admin export            # csv: email,submitted_at,locale,source
python -m flask --app sites.ffm.app:create_app beta-admin export --format json
```

Use the CSV column `email` to paste the addresses into the Play Console test
track ("Testers" list). Oldest entries come first. The address is used for
nothing else; the privacy policy has a dedicated "Android-Beta-Warteliste"
section for it.

## The full version during the beta

Both tracks carry a "Vollversion in der Beta" box, because the unlock behaves
differently per platform while the beta runs:

- **iOS** — the unlock step stays part of the flow, but TestFlight never charges
  anything, so the full version is free for testers.
- **Android** — the unlock is free through a **Google Play promo code** for the
  `arithmoslayer_full_unlock` product; testers request it by mail
  (`info@derschweigert.de`, pre-filled subject) and redeem it in the Play Store.

After the beta both platforms use the normal one-time purchase. The FAQ "Was
kostet die Beta?" repeats the same two routes so the answer is not only inside
the tracks.

## Why there are no inline scripts

Production serves this page with the same strict Content-Security-Policy as the
rest of the site (`script-src 'self' https://challenges.cloudflare.com`,
`connect-src 'self'`). Inline `<script>` blocks, `onclick="…"` attributes and
`javascript:` URLs would all be blocked, so all behaviour lives in the single
external `beta.js` module and all styling lives in `beta.css` + `promo.css`.
The form's `fetch` is same-origin, which is why no `connect-src` change is
needed.

## Locale handling

`beta.js` does not re-implement the locale layer. It imports
`registerDictionary()`, `getLocale()`, `onLocaleChange()`, `t()` and
`toggleLocale()` from `/promo/promo.js`, so this page shares the
`localStorage.ffm_locale` key, the same browser detection and the same
`<html lang>` switching. Every key is prefixed with `beta.`, and
`registerDictionary()` throws on a duplicate key so the two dictionaries can
never shadow each other. The six `beta.waitlist.*` keys are written by the
script rather than the markup; `beta.test.js` allow-lists exactly those and
checks that the script really uses each one.

## Tests

```sh
node --test sites/ffm/static/beta/beta.test.js
python -m pytest sites/ffm/tests/test_beta_waitlist.py
```

The page suite fails on copy drift (markup vs. dictionary), missing or unused
translation keys, keys outside the `beta.` namespace, inline scripts, inline
styles, external origins that are not allow-listed, bare relative URLs, missing
assets, a missing `id="beta-root"` on `<body>` (the deploy smoke test greps for
it), an Android section that pretends the track exists, a waitlist form without
its label/status/mail fallback, a form script missing a failure class, a hero
that re-grows the removed browser fallback, a redefinition of the shared design
tokens, and images without `alt`/`width`/`height` or without a file.

The API suite (`tests/test_beta_waitlist.py`) covers storage and normalisation,
idempotent repeats, locale selection, every rejected payload shape, non-JSON
bodies, `405`/`Cache-Control`, isolation from `USER#` items, the per-IP rate
limit and both CLI export formats.
