# `/promo/` — Arithmo Slayer landing page

One static page that sells the browser game (subscription) and the upcoming
iOS/Android apps (one-time purchase) together. It is plain HTML + CSS + a
single ES module: no build step, no dependencies, no external requests.

| File | Purpose |
| --- | --- |
| `index.html` | The page. Ships **German**; every translatable string carries a `data-i18n*` key. |
| `promo.css` | All styling, animations and the reduced-motion overrides. |
| `promo.js` | Locale dictionary + `setLocale()`, sprite-frame cycling, scroll parallax, reveal observer. |
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

## Tests

```sh
node --test sites/ffm/static/promo/promo.test.js
```

The suite fails on copy drift (markup vs. dictionary), missing or unused
translation keys, inline scripts, external origins, bare relative URLs,
missing art files, a wrong og-image size, a missing `/play` link, missing
`id="promo-root"` on `<body>` (the deploy smoke test greps for it), ranges that
can break after the en dash, and lost CSP/a11y plumbing.

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
