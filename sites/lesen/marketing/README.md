# Buchstabenzeit marketing site

Static single-page site served from `buchstabenzeit.derschweigert.de`. Everything in
this folder is uploaded to its own S3 bucket by the `deploy-lesen` job, so keep it
self-contained: no build step, no external requests.

- `index.html` – the page itself. Styling is inline so the first paint needs no extra
  round trip; `style-src`/`img-src` of the marketing CSP expect that.
- `language.mjs` – English strings for every `data-i18n`, `data-i18n-aria` and
  `data-i18n-alt` attribute, applied when the page is opened with `?lang=en`.
- `marketing.mjs` – progressive enhancement only (scroll reveals, sticky header
  shadow, mobile call-to-action). The page must stay complete without it, and the
  CSP only allows same-origin scripts.
- `images/` – product screenshots, the mascot, the social preview card and the icons.

## Regenerating the images

The screenshots are captured from the real app in `../static`, so they never drift
from what users see:

```bash
node scripts/capture-marketing-assets.mjs
```

Needs Chrome/Chromium (`CHROME_PATH` to override) and `cwebp` from libwebp. Re-run it
whenever the app's selection or reading screen changes, then check
`tests/marketing-page.test.mjs` still passes – it pins the referenced file names and
keeps each asset below 200 KB.
