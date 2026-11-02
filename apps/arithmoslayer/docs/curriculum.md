# Curriculum bands

`data/curriculum/bands.json` is the single source of the skill progression.
Every generated problem belongs to one band, and a band names the operations it
drills, the operand ranges, the largest allowed answer, the answer format, its
prerequisites, and the island it belongs to. Four islands group the bands by
grade. This project imports and copies nothing from the browser game in the
sibling site tree.

## Document shape

```json
{
  "version": 1,
  "islands": [{"id": "grade-1", "name": "Sunny Shore", "grade": 1}],
  "bands": [{
    "id": "g1-within-10", "grade": 1, "island": "grade-1",
    "operations": {"addition": {"a": {"min": 1, "max": 5}, "b": {"min": 1, "max": 5}}},
    "maxResult": 10, "answerFormat": "multiple_choice", "prerequisites": [],
    "noNegativeResults": true
  }]
}
```

An operand range is either an inclusive `min`/`max` pair or a non-empty
`values` list of allowed operands. For addition and subtraction `a` and `b` are
the written operands, for multiplication they are the factors, and for division
`a` is the dividend and `b` the divisor.

The ranges are the pools a band draws from; the band's rules then decide whether
a draw becomes a problem. A draw above `maxResult` is redrawn, a subtraction
draw is ordered so `a >= b`, and a division draw picks a quotient and derives
`a` from it so the quotient is exact.

| Field | Meaning |
| --- | --- |
| `id` | Unique band id; prerequisites reference it. |
| `grade` | 1 to 4. The band's island must have the same grade. |
| `island` | Island id from the top-level `islands` list. |
| `operations` | Non-empty object keyed by `addition`, `subtraction`, `multiplication`, or `division`. Each value holds the `a` and `b` ranges for that operation. |
| `maxResult` | Largest allowed answer. A generator rejects candidates above it. |
| `answerFormat` | How the answer is entered: `numeric` or `multiple_choice`. |
| `freeEntryMastery` | Optional number in (0, 1]. Mastery at which a `multiple_choice` band switches from orbs to free numeric entry. Defaults to 0.75 when absent. |
| `prerequisites` | Earlier band ids that should be mastered first. Empty for the entry band. |
| `noNegativeResults` | Required `true` on every band with subtraction, so `a >= b` and the answer is never negative. |
| `exactDivision` | Required `true` on every band with division, so `a` is a multiple of `b` and the quotient is exact. |
| `crossesTens` | Optional boolean. `true` requires a carry or borrow across a ten boundary, `false` forbids one. |

## Islands

| Island | Grade | Bands |
| --- | --- | --- |
| `grade-1` Sunny Shore | 1 | `g1-within-10`, `g1-within-20-no-carry`, `g1-within-20-carry` |
| `grade-2` Ten Grove | 2 | `g2-within-100-no-carry`, `g2-within-100-carry`, `g2-tables-2-5-10`, `g2-tables-3-4-division` |
| `grade-3` Hundred Hills | 3 | `g3-within-1000`, `g3-tables-to-10`, `g3-division-facts`, `g3-multiples-of-ten` |
| `grade-4` Thousand Peaks | 4 | `g4-within-10000`, `g4-two-digit-by-one-digit`, `g4-three-digit-by-one-digit-division`, `g4-mixed-review` |

## Bands

| Grade | Band | Skill | Operations and operand ranges | Max result | Answer format | Prerequisites |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `g1-within-10` | Add and subtract within 10 | `+` `a` 1–5, `b` 1–5; `-` `a` 1–10, `b` 1–5 | 10 | `multiple_choice` | — |
| 1 | `g1-within-20-no-carry` | Within 20 without crossing ten | `+` `a` 10–18, `b` 1–9; `-` `a` 10–19, `b` 1–9 | 20 | `multiple_choice` | `g1-within-10` |
| 1 | `g1-within-20-carry` | Within 20 crossing ten | `+` `a` 2–9, `b` 2–9; `-` `a` 11–19, `b` 2–9 | 20 | `multiple_choice` | `g1-within-20-no-carry` |
| 2 | `g2-within-100-no-carry` | Within 100 without crossing tens | `+`/`-` `a` 10–99, `b` 10–99 | 100 | `numeric` | `g1-within-20-carry` |
| 2 | `g2-within-100-carry` | Within 100 crossing tens | `+`/`-` `a` 10–99, `b` 10–99 | 100 | `numeric` | `g2-within-100-no-carry` |
| 2 | `g2-tables-2-5-10` | Tables 2, 5, and 10 | `×` `a` ∈ {2, 5, 10}, `b` 1–10 | 100 | `numeric` | `g2-within-100-no-carry` |
| 2 | `g2-tables-3-4-division` | Tables 3 and 4 with division | `×` `a` ∈ {3, 4}, `b` 1–10; `÷` `a` 3–40, `b` ∈ {3, 4} | 40 | `numeric` | `g2-tables-2-5-10` |
| 3 | `g3-within-1000` | Add and subtract within 1000 | `+` `a` 10–990, `b` 10–990; `-` `a` 10–999, `b` 10–990 | 1000 | `numeric` | `g2-within-100-carry` |
| 3 | `g3-tables-to-10` | All tables to 10 | `×` `a` 2–10, `b` 1–10 | 100 | `numeric` | `g2-tables-3-4-division` |
| 3 | `g3-division-facts` | Division facts | `÷` `a` 2–100, `b` 2–10 | 10 | `numeric` | `g3-tables-to-10` |
| 3 | `g3-multiples-of-ten` | Tens such as 7 × 30 | `×` `a` 2–10, `b` ∈ {10, 20, …, 90} | 900 | `numeric` | `g3-tables-to-10` |
| 4 | `g4-within-10000` | Add and subtract within 10000 | `+` `a` 100–9000, `b` 100–990; `-` `a` 100–9999, `b` 100–990 | 10000 | `numeric` | `g3-within-1000` |
| 4 | `g4-two-digit-by-one-digit` | Two-digit by one-digit multiplication | `×` `a` 10–99, `b` 2–9 | 891 | `numeric` | `g3-multiples-of-ten` |
| 4 | `g4-three-digit-by-one-digit-division` | Exact three-digit by one-digit division | `÷` `a` 100–999, `b` 2–9 | 499 | `numeric` | `g3-division-facts`, `g4-two-digit-by-one-digit` |
| 4 | `g4-mixed-review` | Mixed review of all four operations | `+` `a` 100–9000, `-` `a` 100–9999, `b` 100–990; `×` `a` 10–99, `b` 2–9; `÷` `a` 100–999, `b` 2–9 | 10000 | `numeric` | `g4-within-10000`, `g4-two-digit-by-one-digit`, `g4-three-digit-by-one-digit-division` |

## Problem generation

`scripts/core/math/problem_generator.gd` turns a band into one practice
problem. It is plain `RefCounted` logic with no scene tree access, and it draws
from an injected `Rng`, so the same band and seed always produce the same
problem.

```gdscript
var generator := ProblemGenerator.new(Rng.new(seed))
var problem := generator.generate(band)  # {operation, a, b, answer}
```

`generate()` picks one of the band's declared operations and then applies the
band's rules while it draws:

| Operation | Rule |
| --- | --- |
| `addition` | `a` and `b` come from their pools, `a + b <= maxResult`, and the ones digits carry exactly when `crossesTens` is true. |
| `subtraction` | `a >= b` and `a - b <= maxResult`, so the answer is never negative, and the ones digits borrow exactly when `crossesTens` is true. |
| `multiplication` | `a` and `b` come from their pools and `a * b <= maxResult`. |
| `division` | `b` is drawn first, then a quotient `q` with `a = q * b` inside the dividend pool and `q <= maxResult`, so the division is exact. |

`crossesTens` applies to addition and subtraction only. A band whose rules
cannot be satisfied yields an empty dictionary.

`test/unit/math/test_problem_generator.gd` runs 10,000 seeds per band and
asserts the operation, operand ranges, answer bounds, non-negative subtraction,
exact division, and `crossesTens` rules, plus replay from the same seed.

## Distractors

`scripts/core/math/distractors.gd` turns one generated problem into up to three
plausible wrong answers. It is plain `RefCounted` logic with an injected `Rng`,
and every distractor names the error model that produced it.

```gdscript
var builder := Distractors.new(Rng.new(seed))
var distractors := builder.generate(problem)  # [{value, model}, ...]
```

| Error model | Candidate |
| --- | --- |
| `off_by_one` | The answer plus or minus one. |
| `off_by_ten` | The answer plus or minus ten, so a place value is wrong. |
| `wrong_operation` | The other operation on the same operands, such as `a + b` for subtraction. |
| `missed_carry_or_borrow` | The answer minus ten when an addition carries, or plus ten when a subtraction borrows. |
| `neighboring_table_fact` | A neighbouring factor product, such as `(a + 1) * b`, or the neighbouring division fact. |
| `transposed_digits` | The answer with two adjacent digits swapped. |

A candidate that is negative, equals the answer, or repeats an earlier
distractor is skipped. The models rotate from a seed-dependent start, so each
applicable model gets a turn. A problem with too few usable candidates yields
fewer than three distractors.

`test/unit/math/test_distractors.gd` runs 10,000 seeds per band and asserts
non-negative values, distinctness from the answer and each other, known model
tags, and coverage of every applicable error model.

## Answer modes

`scripts/core/math/answer_mode.gd` decides how an answer is entered. A numeric
band always uses free entry. A `multiple_choice` band shows orbs until the
learner's mastery reaches the band's `freeEntryMastery`, then switches to free
entry, so the mode is data-defined and shifts with mastery.

```gdscript
var mode := AnswerMode.new()
var resolved := mode.resolve(band, mastery, distractors.size())  # {kind, orbs}
```

`kind` is `orbs` or `numeric`, and `orbs` counts the answer plus the
distractors clamped to two to four choices. `AnswerMode.NumericEntry` is the
pure input model for free entry: it accepts up to five decimal digits, rejects
non-numeric text, and supports `delete()` and `confirm()`. `confirm()` returns
`-1` while the entry is empty.

`test/unit/math/test_answer_mode.gd` covers the two-to-four orb clamp, the
band-defined mode, the mastery threshold, and the entry rules.

## Feedback and hints

`data/session/feedback.json` defines the gentle hint ladder. `stages` orders
the three rungs (`visual_model`, then `decomposition`, then `answer`), and
`visualModels` names the visual models each operation prefers.

`scripts/core/session/hint_ladder.gd` serves those rungs for one problem.
`wrong()` advances one rung and never moves backwards, `correct()` resets the
ladder for the next problem, and `rung_for()` returns the current hint without
advancing. The first rung names a visual model, the second returns worked
`steps`, and the third returns the `answer` plus a `replay` of the problem.

```gdscript
var ladder := HintLadder.new()          # loads feedback.json
var hint := ladder.wrong(problem)       # {stage: "visual_model", model: "dot_array"}
ladder.wrong(problem)                   # {stage: "decomposition", steps: [...]}
ladder.wrong(problem)                   # {stage: "answer", answer: 8, replay: true, ...}
ladder.correct()                        # resets for the next problem
```

`scripts/core/session/session_queue.gd` is the session's FIFO of problems.
`requeue()` appends a missed problem to the end, so a wrong answer returns
later in the same session instead of repeating immediately.

`scripts/ui/visual_models/visual_models.gd` (scene
`scenes/ui/visual_models/visual_models.tscn`) renders one problem as any of the
four models: `dot_array`, `ten_frame`, `number_line`, and `equal_groups`.
`build(problem, model_type)` clears `ModelRoot` and rebuilds deterministic
labelled nodes from the problem data, capping dots, frames, ticks, and groups
so large bands stay bounded. `test/integration/visual_models/test_visual_models.gd`
instantiates the scene headlessly for every model type and asserts node counts
and labels.

## Mastery and selection

`data/mastery/intervals.json` names the spaced-review ladder
(`intervals`), the slow-answer threshold (`slowThresholdMs`), and the EMA
learning rate (`learningRate`). `data/session/selection.json` names the
selector's target first-attempt accuracy (`targetAccuracy`), the size of the
recent-accuracy window (`windowSize`), the mastery threshold that unlocks a
prerequisite (`masteryThreshold`), the new/review/challenge mix (`weights`), and
whether operations are interleaved (`interleaveOperations`).

`scripts/core/mastery/mastery_model.gd` is `MasteryModel`, plain `RefCounted`
logic that keeps per-band accuracy, fluency, rewards, stage, and due-in. A
correct answer raises accuracy and rewards and advances the review stage; a
slow correct answer still raises both but lowers fluency. A wrong answer lowers
accuracy and resets the stage so the band is due for review. `mastery_for()`
weights accuracy over fluency.

`scripts/core/session/selector.gd` is `Selector`, which holds an injected `Rng`,
`ProblemGenerator`, `MasteryModel`, the band list, and the selection config.
`unlocked_band_ids()` returns bands whose prerequisites are mastered,
`recent_accuracy()` reports the fraction correct over the last window,
`record_result()` feeds that window, and `select()` returns
`{problem, band, category}` after mixing new, review, and challenge bands and
nudging the challenge share toward the target accuracy. The same profile and
seed replay the same sequence.

## Validation

`tools/validate_data.py` discovers `tools/validate/curriculum.py`, which
rejects malformed JSON, a missing required field, an unknown operation, an
empty or inverted operand range, a division range that includes zero, an
unknown or self-referencing prerequisite, an unknown island, an island whose
grade does not match the band, a subtraction band without `noNegativeResults`,
a division band without `exactDivision`, and a `freeEntryMastery` outside
(0, 1]. `tools/validate/feedback.py` rejects a feedback document with the wrong
version, stages out of order, an unknown operation, a missing or empty model
list, and an unknown or duplicate model id. `tools/validate/mastery.py` rejects
a mastery document with the wrong version, an empty or non-ascending interval
ladder, a non-positive slow threshold, or a learning rate outside (0, 1], and
`tools/validate/selection.py` rejects a selection document with the wrong
version, a target accuracy or mastery threshold outside (0, 1], a non-positive
window, a non-boolean interleave flag, or missing or negative category weights.
Every error names the file, line, and field.

```sh
cd apps/arithmoslayer
python3 tools/validate_data.py
godot-test . -gtest=test_curriculum.gd
```

`test/unit/math/test_curriculum.gd` checks that the real data holds one band per
skill across the four grades and that the main rejection paths above fail.
