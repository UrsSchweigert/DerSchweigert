// Rewrites the operations / operandRange / maxResult of app/level_data.json so
// difficulty ramps progressively: operands run up to a cap of 3 at level 1,
// 10 at level 4 and 30 at level 60 (steep early, soft late; see maxOperand),
// starting at 1 and including 0 from level 5 on.
// Operations unlock one per ten levels (+ L1, - L10, x L20, / L30); from level 40
// all four are mixed evenly. The unlock levels lean on the new operation (half of
// the questions) so the spike is felt immediately, then eases off for a few levels. From level 10 the generator
// (levels.js) also hides an operand in about a third of the questions.
// Fiend hit points, wave size etc. are untouched. Run update-level-data.mjs after
// this to refresh the baseline scores, then `npm run copy-assets` in mobile/.
import { readFileSync, writeFileSync } from 'node:fs';

// Zero joins the operands at this level; before it every operand is at least 1.
export const ZERO_FROM_LEVEL = 5;
export const UNLOCK = [['+', 1], ['-', 10], ['*', 20], ['/', 30]];

// Concave power curve a + b * level^p through (1, 3), (4, 10) and (60, 30).
const CURVE = { a: -21.37748446735181, b: 24.37748446735181, p: 0.18209021767061398 };
export const maxOperand = level => Math.round(CURVE.a + CURVE.b * level ** CURVE.p);

// Share of the newest operation on the levels after it unlocks: half on the spike
// level itself, then an easier stretch (as a fraction of the even share) that
// climbs back to an even mix.
export const NEWEST_SHARE_FACTOR = [null, 0.4, 0.6, 0.8, 0.9];
const POOL_SIZE = 20;

export function operationsFor(level) {
  const active = UNLOCK.filter(([, from]) => level >= from);
  const ops = active.map(([op]) => op);
  const [newestOp, from] = active[active.length - 1];
  const factor = NEWEST_SHARE_FACTOR[level - from];
  if (from === 1 || factor === undefined) return ops;
  const share = factor === null ? 0.5 : factor / ops.length;
  const older = ops.filter(op => op !== newestOp);
  const newestCount = Math.round(share * POOL_SIZE);
  const out = Array(newestCount).fill(newestOp);
  const rest = POOL_SIZE - newestCount;
  older.forEach((op, i) => {
    out.push(...Array(Math.floor(rest / older.length) + (i < rest % older.length ? 1 : 0)).fill(op));
  });
  return out;
}

// x and / open gently: their operands stay at 10 for the first five levels after
// they unlock, then grow by 3 per level until they meet the level's cap.
export const GENTLE_CAP = 10;
export const GENTLE_LEVELS = 5;
export function operationCap(op, level, cap) {
  const from = UNLOCK.find(([o]) => o === op)[1];
  if ((op !== '*' && op !== '/') || level < from) return cap;
  const since = level - from;
  return Math.min(cap, since < GENTLE_LEVELS ? GENTLE_CAP : GENTLE_CAP + 3 * (since - GENTLE_LEVELS + 1));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const file = new URL('../app/level_data.json', import.meta.url);
  const data = JSON.parse(readFileSync(file, 'utf8'));
  for (const cfg of data.levels) {
    const m = maxOperand(cfg.level);
    cfg.operations = operationsFor(cfg.level);
    const min = cfg.level >= ZERO_FROM_LEVEL ? 0 : 1;
    cfg.operandRange = { a: [min, m], b: [min, m] };
    delete cfg.operandRangeByOp;
    for (const op of ['*', '/']) {
      const cap = operationCap(op, cfg.level, m);
      if (cap < m && cfg.operations.includes(op)) {
        cfg.operandRangeByOp = { ...cfg.operandRangeByOp, [op]: { a: [min, cap], b: [min, cap] } };
      }
    }
    cfg.maxResult = 2 * m;
  }
  writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}
