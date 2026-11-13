# `/promo/` — Arithmo Slayer landing page

One static page that sells the browser game (subscription) and the upcoming
iOS/Android apps (one-time purchase) together. It is plain HTML + CSS + a
single ES module: no build step, no dependencies, no external requests.

| File | Purpose |
| --- | --- |
| `index.html` | The page. Ships **German**; every translatable string carries a `data-i18n*` key. |
| `promo.css` | All styling, animations and the reduced-motion overrides. |
| `promo.js` | Locale dictionary + `setLocale()`, scroll parallax, reveal observer. |
| `og-image.png` | 1200×630 social preview, composited from the key art + logo. |
| `promo.test.js` | `node:test` regression suite (see below). |
| `tools/render-og.py` | Regenerates `og-image.png` with Pillow. |

## Preview locally

Serve the static root (not the `promo/` folder — every asset is referenced
root-relative, e.g. `/game/title-logo.webp`, and the page loads
`/promo/promo.css` + `/promo/promo.js`):

```sh
cd sites/ffm/static
python3 -m http.server 8765
# then open http://127.0.0.1:8765/promo/index.html
```

In production the page is what `/` serves: a CloudFront viewer-request
function rewrites `/` and `/promo` to `/promo/index.html` without changing the
browser URL. That is why **nothing** may be a bare relative path — `promo.css`
would resolve to `/promo.css` at `/` and to `/promo/promo.css` at `/promo`.
`promo.test.js` fails on any `src`/`href` that is not root-absolute,
`https://arithmoslayer.de/…`, `mailto:` or a `#anchor`.

## What the page shows

| Section | Anchor | Content |
| --- | --- | --- |
| Hero | `#hero` | Centred poster: kicker, logo with shine, headline, then the CTA block in priority order — the brass-filled, glowing **open-beta pill** (`hero.betaLabel`/`hero.betaText` → `/beta/`, own row) first, the two disabled store badges second, the browser game as a ghost button last — plus the payment-split subline. The stage is landscape only (act-1 backdrop, sunrise gradient, intro village, parallax) — no characters. |
| Gameplay band | `#screenshots` | Five half-size full portrait app captures (strike, fireball, blitz, dragon, healing) in CSS phone bodies, looping continuously right above the generations section. A duplicated `aria-hidden` set makes the loop seamless; hover or focus pauses it. |
| Age cards | `#generationen` | Kindergarten / Grundschule / Erwachsene: `art/heroes/hero-*.webp` standing on `art/stages/stage-*.webp`, one aspect ratio and one hero baseline for all three. |
| Handcrafted | `#kunst` | Story wrap-up, the six finished acts from `art/acts/act-1…6.webp` in the keyboard-scrollable filmstrip with their real titles, three action stills (`art/action/{fight,fireball,lightning}.webp`), and the fiend parade with the dragon. |
| How it plays | `#spiel` | Four difficulty cards with inline-SVG iconography (shape trio for Shapes, one to three swords for Easy/Medium/Hard) and a visually hidden "difficulty n of 3" sentence. |
| Pricing | `#preise` | Subscription vs. one-time purchase and the comparison table. |
| Family | `#familie` | Profile cards with the `head-*.webp` portraits, a CSS-built phone mockup around `art/ui/title-screen.webp`, store chips. |
| FAQ / footer | `#faq` | Legal links, support address. |

Every `<img>` carries `width`/`height`; only the hero backdrop uses
`fetchpriority="high"`, everything below the fold is `loading="lazy"` +
`decoding="async"`.

## Art

`art/` is generated off-page and is **not** edited here:

* `art/heroes/` — three full figures (512×640, transparent) and three head
  portraits (256/240/232 px, transparent) for the age cards and profiles.
* `art/stages/` — three 1600×1000 stages, small → mid → grand.
* `art/acts/` — the six finished 1920×1080 act dioramas.
* `art/action/` — three 1600×900 gameplay stills (melee, fireball, lightning).
  Underscore-prefixed files in that folder are intermediates and are never
  referenced.
* `art/shots/` — five full portrait 1170×2532 captures from the **app bundle**
  (`mobile/www`), one per action and level: strike (1), fireball (10), blitz
  (20), dragon (30), healing (40). They are uncropped, so the encounter sword
  row and the action bar stay in frame. The page shows them at half size in the
  looping `#screenshots` band; that loop is markup-only (a second
  `aria-hidden` set of the same five), so the files are still generated once.
  `tools/capture-gameplay.py` regenerates them; nothing is played by hand.
* `art/ui/title-screen.webp` — the real app screenshot (1170×2532). The 2.79 MB
  `.png` next to it is the source and must stay unreferenced.

## Tests

```sh
node --test sites/ffm/static/promo/promo.test.js
```

The suite fails on copy drift (markup vs. dictionary), missing or unused
translation keys, inline scripts, external origins, bare relative URLs,
missing art files, a wrong og-image size, a missing `/play` link, missing
`id="promo-root"` on `<body>` (the deploy smoke test greps for it), ranges that
can break after the en dash, and lost CSP/a11y plumbing.

The redesign is pinned as well: the hero stage may not reference a character
sprite, the three age cards must pair `hero-child`/`hero-teen`/`hero-adult`
with `stage-small`/`stage-mid`/`stage-grand`, all six `art/acts/act-N.webp`
must be referenced and exist, the three action stills must exist (`.png` or
`.webp`), the five `art/shots/level-*.webp` captures must exist in their phone
bodies with 1170×2532 dimensions and captions, the band must duplicate them
into an `aria-hidden` set and pause on hover/focus, the icon counts per difficulty
card are asserted by counting `data-icon="sword"` / `data-icon="shape"`, the
phone mockup must use the webp screenshot, and the store buttons must be
disabled buttons without `href`.

## Why there are no inline scripts

Production serves this page with a strict Content-Security-Policy
(`script-src 'self' https://challenges.cloudflare.com`). Inline `<script>`
blocks, `onclick="…"` attributes and `javascript:` URLs would all be blocked,
so all behaviour lives in the single external `promo.js` module and all styling
lives in `promo.css`.

## Locale handling

* The HTML is German, so no-JS visitors and crawlers always get German.
* Initial locale in `promo.js`: stored `localStorage.ffm_locale` wins;
  otherwise German — unless `navigator.language` exists and does not start
  with `de`, then English. `ffm_locale` (`de`/`en`) is the key the game itself
  uses (`game/i18n.js`), so the language picked here is the one `/play` opens
  with, and the privacy policy only has to list one key.
* The toggle is an action, not a state: it has an `aria-label` naming the
  target language and no `aria-pressed`. Without JS (`<html class="no-js">`,
  removed by `promo.js`) it is hidden, because it could not do anything.
* The header toggle (`#promo-lang-toggle`) swaps `textContent`, translatable
  attributes and `<html lang>` without a reload. The document `<title>`/meta
  description stay German on purpose (canonical German page).
* `registerDictionary()` extends this dictionary from another page's module,
  so `/beta/` reuses the same storage key, detection and `translateDom()`
  instead of copying them. It throws on a duplicate key, and it has to run at
  import time — `boot()` waits for `DOMContentLoaded` for exactly that reason.
* `splitRanges()` rebuilds the `Level 1–2` guard on every runtime translation:
  numeric ranges are written back into `<span class="nb">`, so German never
  breaks after the en dash even though `textContent` is replaced.

## Regenerating the social image

```sh
python3 sites/ffm/static/promo/tools/render-og.py
```

It crops `game/title-art-wide.webp` to exactly 1200:630 at the left edge and
just past the arithmetic glyphs (the second, cut-off glyph column of the source
image stays outside the frame), composites `game/title-logo.webp` and the
tagline plate on top, adds a brass hairline frame and writes `og-image.png`.
No second character is drawn over the painted hero. The palette is reduced to
160 colours to stay under 400 KB.

## Regenerating the gameplay screenshots

```sh
python3 sites/ffm/static/promo/tools/capture-gameplay.py
```

Run it with an interpreter that has Playwright (with the Chrome channel) and
Pillow installed; the repository's `.venv` does.

The filmstrip shows the **app** build, not the website, so the script first runs
`npm run copy-assets` in `sites/ffm/mobile` and then serves `mobile/www` over a
localhost HTTP server. It seeds a fake `Capacitor.Plugins.Preferences` backed by
`localStorage` (purchase entitlement, a profile with all 60 levels completed,
and the acknowledged first-open notice), opens the target level from the app's
Levels grid, and answers real questions through the DOM until the combo band is
reached. The completed-levels record only opens the app's own Levels grid; the
five target levels then run on their real level data, so no campaign is played
through and no rules are bypassed.

Each screenshot is taken from a frozen frame: an init script wraps
`requestAnimationFrame`, and once the requested action effect
(`heroStrike`, `fireball`, `lightning`, `dragonFinisher`) has played for the
configured number of milliseconds, the callback is dropped. The healing still
waits for the hold-to-heal progress to reach 78 %. That keeps the timing exact
instead of racing a live canvas. The full-resolution PNG masters are written to
`sites/ffm/promo-shots/` for reuse; the page assets are the WebP q82
derivatives in `art/shots/`.

The captures use a 390×844 viewport at `deviceScaleFactor: 3` (1170×2532), the
same German locale (`ffm_locale = 'de'`) and the same app chrome as
`art/ui/title-screen.webp`. Use `--only strike|fireball|blitz|dragon|heal` to
regenerate a single shot, `--out DIR` to write the WebP page assets elsewhere,
and `--shots-dir DIR` to write the PNG masters elsewhere.
