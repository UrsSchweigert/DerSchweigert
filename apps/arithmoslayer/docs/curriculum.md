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

## Validation

`tools/validate_data.py` discovers `tools/validate/curriculum.py`, which
rejects malformed JSON, a missing required field, an unknown operation, an
empty or inverted operand range, a division range that includes zero, an
unknown or self-referencing prerequisite, an unknown island, an island whose
grade does not match the band, a subtraction band without `noNegativeResults`,
and a division band without `exactDivision`. Every error names the file, line,
and field.

```sh
cd apps/arithmoslayer
python3 tools/validate_data.py
godot-test . -gtest=test_curriculum.gd
```

`test/unit/math/test_curriculum.gd` checks that the real data holds one band per
skill across the four grades and that the main rejection paths above fail.
