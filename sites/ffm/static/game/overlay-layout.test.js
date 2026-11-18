// Guards for the layout bugs reported from the iPhone app (landscape): prose
// larger than button labels, the save prompt stacked under the sound panel,
// misaligned sound rows, an orphaned result button and uneven HUD labels.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
const i18n = readFileSync(new URL('./i18n.js', import.meta.url), 'utf8');

test('iOS may not inflate paragraph text next to un-inflated buttons', () => {
  assert.match(css, /^html \{ -webkit-text-size-adjust: 100%; text-size-adjust: 100%; \}/m);
});

test('the save prompt is hidden while the sound panel is open, even against its inline display', () => {
  assert.match(
    css,
    /#pause-overlay:has\(#audio-settings\[open\]\) #pause-quit-actions \{ display: none !important; \}/,
  );
});

test('sound rows share one left-aligned label column, with the checkbox beside the sliders', () => {
  const rule = css.match(/^\.audio-controls \{ grid-template-columns: minmax\(0, 1fr\);([^}]*)\}/m)?.[1];
  assert.ok(rule, 'audio-controls override missing');
  assert.match(rule, /justify-items:\s*stretch;/);
  assert.match(rule, /text-align:\s*left;/);
  assert.doesNotMatch(css, /#haptics-toggle \{[^}]*justify-self:\s*center/);
  assert.match(css, /#btn-audio-back \{ margin-top: 8px; \}/);
});

test('the "control is available" status is only visible when the control is not', () => {
  assert.match(css, /#music-volume:not\(:disabled\) \+ #music-volume-status \{[^}]*clip-path: inset\(50%\)/);
});

test('the third result button takes a full row instead of sitting alone in the left half', () => {
  assert.match(css, /#btn-save-score-return-title \{ grid-column: 1 \/ -1; \}/);
});

test('HUD counters use the same unpunctuated "Label value" form as the other readouts', () => {
  for (const key of ['gameplay.encounters', 'gameplay.encountersCompact', 'gameplay.healProgress']) {
    const line = i18n.split('\n').find(l => l.includes(`'${key}'`));
    assert.ok(line, `${key} missing`);
    assert.doesNotMatch(line, /[A-Za-zäöü]: \{/, `${key} still has a colon`);
  }
});
