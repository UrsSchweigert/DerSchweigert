# Accessibility pass (P6 / requirement 6.1)

Audited baseline: `58b8951`. The fixes listed below land in the same commit as
this document. Scope is the shared web source in `sites/lesen/static`, which is
what both the website and the Capacitor Android/iOS shells render.

## Scope and method

Screens and surfaces covered, in both German and English:

- setup (language switch, letter selection, mode rows, card count, adult note)
- practice (card, stats, progress, read-aloud, grade buttons, feedback)
- completion (summary, new round, change letters)
- about dialog (close button, headings, privacy and licence links)
- adult-gated practice-reminder dialog (gate form, settings, status)
- confirm-end dialog and the footer controls

Method: static review of the DOM order, stylesheet and module wiring, plus
computed contrast ratios and CSS-declared target sizes. The existing suite
(`node --test tests/*.test.mjs`) was run unchanged; the new
`tests/accessibility.test.mjs` guards the contract below.

No physical-device screen-reader run was performed in this pass. TalkBack and
VoiceOver verification, real speech audio in airplane mode, and OS large-text
settings remain revision-bound manual gates (see "Pending device gates").

## Findings and fixes

### Reading order

DOM order matches visual order on every screen: language control, intro,
selection fieldsets, mode rows, start button, adult note; then practice card,
stats, progress, actions, feedback; then completion. The only intentional
mismatch is the language control, which sits visually top-right but comes first
in the DOM so the persistent language choice is reachable before the long
letter grid. Dialogs are native `<dialog>` elements opened with `showModal()`,
so the rest of the page is inert while they are open.

No change required.

### Keyboard access and visible focus

- All controls are native `button`, `input`, `label` and `summary` elements;
  letter buttons are real buttons with `aria-pressed`.
- Dialogs use native focus containment and Escape; the confirm dialog autofocuses
  "Weiter üben", the about dialog focuses the close button, the completion
  heading receives focus with `tabindex="-1"`, and the Android Back handler
  closes an open dialog before leaving the screen.
- Fixed: the shared focus rule covered only `button` and `input`. Links
  (privacy/licence) and the adult-note `<summary>` had no visible focus ring.
  `summary:focus-visible` and `a:focus-visible` now share the same 3px
  `--orange` outline at 4px offset (4.98:1 against the paper background, above
  the 3:1 non-text requirement).
- Fixed: the language buttons showed their active state only through a CSS
  class. They now expose `aria-pressed` in the markup and keep it in sync in
  `setLanguage`.

### Touch targets (measured from the stylesheet)

| Control | Size | Verdict |
| --- | --- | --- |
| Language DE/EN | `min-width/height: 44px` | pass |
| Letter buttons | `min-height: 54px` (46px narrow), full grid column | pass |
| Mode and pattern rows | whole row is the label, 13px vertical padding | pass |
| Card-count input | 12px padding + 20px font (~46px) | pass |
| Start / grade / dialog buttons | `min-height: 44px`; `.action` 58px | pass |
| About close button | 44x44 after fix (was 40x40) | fixed |
| Footer link buttons | `min-height: 44px` after fix (was ~15px) | fixed |
| Reminder checkbox | 17px box inside a full-row label | pass via label |

The radio and checkbox inputs themselves are 17px, but each is wrapped in a
label that is the full mode or sub-pattern row, so the effective pointer target
is the row, not the glyph.

### Text scaling

- Fixed: the viewport meta carried `maximum-scale=1, user-scalable=no`, which
  blocked pinch zoom and browser text scaling on the website. It is now
  `width=device-width, initial-scale=1, viewport-fit=cover`; the safe-area
  opt-in is unchanged.
- Fixed: the confirm-end dialog had no height cap, so at large text sizes on a
  short screen its actions could be clipped. It now uses `max-height: 80vh`
  with `overflow-y: auto`, matching the about dialog.
- The practice card already auto-fits its text through `updateCardFontSize`,
  and the card height adapts in the narrow and landscape media queries.
- Not verified here: OS-level font scaling inside the Android WebView and iOS
  `UIContentSizeCategory`; that needs a device.

### Contrast (WCAG AA)

| Pair | Ratio |
| --- | --- |
| `--ink` on `--paper` | 10.69:1 |
| `--muted` on `--paper` | 4.86:1 |
| white on `--blue` (primary) | 6.73:1 |
| white on `--green` (correct, after fix) | 5.24:1 |
| `--green` completion mark on `#e9f8dc` (after fix) | 4.72:1 |
| review label `--orange` on card gradient | 4.98–5.05:1 |
| focus outline `--orange` on paper | 4.98:1 |

Fixed: `--green` was `#65ad35`, giving only 2.77:1 for the white "Richtig
gelesen" label and 2.50:1 for the completion mark. It is now `#3f7a1a`, and the
hover state moved to `#356b12` (6.44:1). No other token changed.

### Document and card language

- `setLanguage` writes `document.documentElement.lang` on every switch and at
  startup, so the document language follows the saved choice.
- Fixed: the card text now sets `lang` from the exercise language in
  `renderCard` instead of relying on inheritance, so a card is announced in its
  own language even if the platform UI language differs.
- Fixed: the about close button had a hard-coded German `aria-label`. Because
  it receives focus when the dialog opens, English users heard "Schließen".
  The label now comes from `dialog.about.close` and updates with the UI.
- The German and English privacy pages each declare their own `lang`, and the
  about dialog links to the matching one.

### Live regions and read-aloud

- `#syllable` is the single polite live region for the card (`aria-atomic`),
  so each new card is announced once.
- `#feedback` (`role="status"`) carries the result message ("Karte geschafft.",
  "Versuch es noch einmal."). It is a different message from the card, not a
  duplicate of it.
- Read-aloud is only started by the explicit "Vorlesen" button; `renderCard`
  never speaks automatically, so speech does not compete with the live region.
  `speakCard` reuses `#feedback` for unsupported, missing-voice and playback
  errors.
- Other status regions (`#report-status`, `#reminders-status`,
  `#reminders-gate-error`) are only written when their own control is used, and
  `#setup-error` is a single `role="alert"` that is cleared before reuse.
- Fixed: the completion summary was not announced when focus moved to the
  heading. `#complete-title` now references `#complete-summary` with
  `aria-describedby`, so the result is read once as part of the focused
  heading rather than as a competing live announcement.

No new duplicate or competing announcements were introduced.

## Pending device gates (manual, revision-bound)

1. TalkBack on a physical Android device: reading order across all screens,
   focus transitions into/out of the three dialogs, and that the card and
   feedback announcements are not duplicated.
2. VoiceOver on a physical iOS device: the same pass, including the native
   speech bridge and the adult-gated reminder dialog.
3. Real speech audio in airplane mode for an installed German voice, plus the
   missing-voice and playback-error explanations.
4. System large-text settings and display zoom on both platforms, and the
   Android system contrast/bold-text options.
5. Reminder notification delivery (out of scope for this pass).

These require hardware and are recorded here as outstanding, not as passed.
