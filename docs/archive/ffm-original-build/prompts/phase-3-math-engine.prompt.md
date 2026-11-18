---
description: >
  Phase 3 LEAD — Math problem generator for all 40 levels.
  You are the LEAD agent (Claude Sonnet 5). Your primary value is verifying mathematical correctness.
  Decompose into worker tasks, spawn Haiku workers, then rigorously verify every formula,
  range constraint, and edge case yourself before declaring done.
tools:
  - read_file
  - run_in_terminal
  - replace_string_in_file
  - runSubagent
---

# Phase 3 Lead — Math Engine

## Your responsibilities

1. Read `ffm-math-game.prompt.md` math curriculum section in full.
2. Dispatch the three worker tasks below.
3. After each worker: read the output file. As the Sonnet 5 lead, **personally verify**:
   - All 40 level operand ranges match the spec table exactly
   - Subtraction results can never be negative (a >= b always enforced)
   - Division results are always integers (generated as `answer * b` then presented as `a / b`)
   - Distractor uniqueness is guaranteed
   - LCG is deterministic (same seed → same sequence on any JS engine)
4. Run `node --test sites/ffm/static/game/levels.test.js` — must exit 0.
5. If math errors found: do not ask a worker to fix logic errors — fix them yourself inline
   (this is your core competency). Only use workers for boilerplate.
6. Report `SUCCESS` or `FAILED:<reason>`.

---

## Worker task decomposition

### Worker 1 — LCG + `generateProblem` core
**File:** `sites/ffm/static/game/levels.js` (initial version, Chapters 1–2 only)

Micro-brief must specify:
- The exact LCG constants: `a=1664525`, `c=1013904223`, `Math.imul`, unsigned 32-bit
- `generateProblem(levelIndex, seed)` signature and return shape
- Chapter 1 (addition): operand ranges for all 10 levels as literal arrays, not computed
- Chapter 2 (subtraction): `a = rng.nextInt(b_min, b_max); b = rng.nextInt(1, a)` pattern
  so result is always non-negative
- Distractor algorithm: off-by-one, off-by-small-multiple, random-in-range; retry loop

### Worker 2 — `generateProblem` Chapters 3–4 + `LevelConfig` array
**File:** `sites/ffm/static/game/levels.js` (complete the file)

Micro-brief must specify:
- Chapter 3 multiplication: exact table ranges for each level pair
- Chapter 4 division: `answer = rng.nextInt(1, max_answer); a = answer * b;`
  present as `"${a} ÷ ${b} = ?"`, never as `"${a} / ${b} = ?"`
- Full `LevelConfig` array: 40 entries with every field from the spec
- `waveSize` formula: `3 + Math.floor(level / 5)` (level is 1-based)
- Fiend HP: exact ranges per level band as a lookup function (not a long if-else chain)

### Worker 3 — Test file
**File:** `sites/ffm/static/game/levels.test.js`

Micro-brief must specify: all 7 test cases from the spec, using `node:test` and `node:assert`.
Include 1000-iteration fuzzing for subtraction non-negative and division integer checks
(loop seeds 0–999).

---

## Math verification checklist (lead checks personally)

- [ ] Level 1 operand ranges: a ∈ [1,5], b ∈ [1,5], max answer ≤ 10
- [ ] Level 11 subtraction: result = a − b, b ≤ a always
- [ ] Level 21 multiplication: b ∈ [2,3], a ∈ [1,10], product ≤ 30
- [ ] Level 31 division: answer is always an integer, ÷ symbol used
- [ ] Level 40 max result ≤ 1000
- [ ] waveSize(1) = 3, waveSize(10) = 5, waveSize(40) = 11
- [ ] Same seed produces same problem (run `generateProblem(0, 42)` twice, compare)



## File: `sites/ffm/static/game/levels.js`

Export one named export `LevelConfig` and one named export `generateProblem`.

### `LevelConfig` — array of 40 objects (index 0 = level 1)

Each entry:
```js
{
  level: Number,          // 1–40
  chapter: Number,        // 1–4
  chapterName: String,    // "Addition" | "Subtraction" | "Multiplication" | "Division"
  operations: [String],   // subset of ['+', '-', '*', '/']
  operandRange: {
    a: [min, max],        // inclusive range for left operand
    b: [min, max],        // inclusive range for right operand
  },
  maxResult: Number,      // upper bound on the answer (used for distractor clamping)
  fiendType: String,      // "slimeling"|"bonehead"|"toadlord"|"magelitch"
  fiendHP: Number,        // 1–4 (see table below)
  waveSize: Number,       // 3 + floor(level / 5)
  inputMode: String,      // "multiple-choice" (levels 1–5) | "free-text" (levels 6–40)
}
```

### Level definitions (exact operand ranges required)

**Chapter 1 — Addition (levels 1–10):**
| Level | a range | b range | maxResult |
|-------|---------|---------|-----------|
| 1 | [1,5] | [1,5] | 10 |
| 2 | [1,5] | [1,5] | 10 |
| 3 | [1,10] | [1,10] | 20 |
| 4 | [1,10] | [1,10] | 20 |
| 5 | [1,20] | [1,10] | 30 |
| 6 | [1,20] | [1,10] | 30 |
| 7 | [1,20] | [1,20] | 40 |
| 8 | [1,20] | [1,20] | 40 |
| 9 | [1,50] | [1,50] | 100 |
| 10 | [1,50] | [1,50] | 100 |

**Chapter 2 — Addition + Subtraction (levels 11–20):**
Subtraction: always generate `a >= b` so result ≥ 0.
| Levels | a range | b range | maxResult |
|--------|---------|---------|-----------|
| 11–13 | [5,20] | [1,a] | 20 |
| 14–16 | [1,30] | [1,30] | 30 |
| 17–20 | [1,100] | [1,100] | 100 |

**Chapter 3 — Multiplication (levels 21–30):**
| Levels | a range | b range (multiplier) | maxResult |
|--------|---------|----------------------|-----------|
| 21–22 | [1,10] | [2,3] | 30 |
| 23–24 | [1,10] | [2,4] | 40 |
| 25–26 | [1,10] | [2,6] | 60 |
| 27–28 | [1,10] | [2,9] | 90 |
| 29–30 | [2,25] | [2,12] | 300 |

**Chapter 4 — All four operations (levels 31–40):**
Division: generate `a = answer * b` first, then present `a / b`. Answer always integer.
| Levels | a/answer range | b range | maxResult | operations |
|--------|----------------|---------|-----------|-----------|
| 31–33 | [1,100] | [2,9] | 200 | +,-,*,/ |
| 34–36 | [1,200] | [2,12] | 500 | +,-,*,/ |
| 37–40 | [1,500] | [2,20] | 1000 | +,-,*,/ |

### Fiend HP by level range

| Levels | Base HP |
|--------|---------|
| 1–15 | 1 |
| 16–22 | randomly 1 or 2 (50/50) |
| 23–30 | 2 |
| 31–35 | randomly 2 or 3 (50/50) |
| 36–40 | randomly 3 or 4 (50/50) |

### `generateProblem(levelIndex, rngSeed)` function

Parameters:
- `levelIndex`: 0-based index into `LevelConfig`
- `rngSeed`: integer seed (use a simple seeded LCG, not `Math.random`)

Returns:
```js
{
  question: String,    // e.g. "7 + 5 = ?"
  answer: Number,      // correct integer answer
  distractors: [Number, Number, Number],  // only for inputMode == 'multiple-choice'
  operation: String,   // '+' | '-' | '*' | '/'
}
```

**Distractor rules (multiple-choice levels only):**
Generate exactly 3 distractors. All must be:
- Distinct from `answer`
- Distinct from each other
- Non-negative integers
- Within `[max(0, answer - maxResult*0.3), answer + maxResult*0.3]` (plausible range)

Distractor strategy:
1. `answer ± 1` (off-by-one)
2. `answer ± small_multiple` where small_multiple ∈ {2,3,4,5} chosen by LCG
3. Random value within the plausible range from LCG

If any two distractors collide with each other or with `answer`, regenerate until distinct
(max 50 attempts, then fall back to `answer + offset` for offset in 1..50 until distinct).

**Seeded LCG implementation (must be deterministic cross-platform):**
```js
function lcg(seed) {
  // LCG constants from Numerical Recipes
  let s = seed >>> 0;
  return {
    next() {
      s = (Math.imul(1664525, s) + 1013904223) >>> 0;
      return s;
    },
    nextInt(min, max) {   // inclusive
      return min + (this.next() % (max - min + 1));
    }
  };
}
```

## File: `sites/ffm/static/game/levels.test.js`

Node built-in test runner (`node:test`). Must cover:

1. `LevelConfig` has exactly 40 entries, all with valid `level`, `chapter`, `operations`,
   `fiendType`, `inputMode` fields.
2. For every level, `generateProblem(i, 42)` returns a problem where `eval(question.replace(' = ?',''))` equals `answer`.
3. For levels 1–5, `distractors` has length 3, all distinct from each other and from `answer`.
4. For levels 6–40, `distractors` is undefined or empty.
5. Subtraction answers are never negative (test 1000 random seeds for levels 11–20).
6. Division answers are always integers (test 1000 random seeds for levels 31–40).
7. `waveSize` for level 1 = 3, level 10 = 5, level 40 = 11.

## Done when

`node --test sites/ffm/static/game/levels.test.js` exits 0 with all subtests passing.
