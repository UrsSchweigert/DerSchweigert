# Gameplay screenshots

Full-resolution PNG masters of the five portrait app captures used by the
looping gameplay band on the landing page (`/`) and the beta page (`/beta/`).

All five are 1170×2532, German UI, and were captured from the **app bundle**
(`mobile/www`), not the website. They are uncropped, so the encounter sword row
and the action bar stay in frame. No generated model and no retouching.

| File | Level | Action |
| --- | --- | --- |
| `level-01-strike.png` | 1 | melee strike |
| `level-10-fireball.png` | 10 | fireball in flight |
| `level-20-blitz.png` | 20 | lightning bolt |
| `level-30-dragon.png` | 30 | dragon breath |
| `level-40-healing.png` | 40 | hold-to-heal at 78 % |

The web-optimized WebP derivatives live in
`../static/promo/art/shots/` and are what both pages reference. Regenerate the
masters and the derivatives together with:

```sh
python3 sites/ffm/static/promo/tools/capture-gameplay.py
```

The script writes the PNG masters here and the WebP files to
`../static/promo/art/shots/`. The capture method (seeded app state, level-grid
jump, combo band, frozen frame) is documented in
`../static/promo/art/PROVENANCE.md` and `../static/promo/README.md`.
