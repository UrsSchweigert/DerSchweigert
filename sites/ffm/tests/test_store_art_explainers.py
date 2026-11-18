"""The explainer screenshots (store-art/tools/explainers.py) must say what the game does.

Every number on the three cards is checked against the code that decides it, so a
change to the combo bands, the curriculum or the boss levels fails here instead of
shipping a store listing that describes a different game.
"""

import json
import re
from pathlib import Path

import pytest

FFM = Path(__file__).resolve().parents[1]
COPY = json.loads((FFM / "store-art" / "copy" / "explainers.json").read_text(encoding="utf-8"))
GAME = FFM / "static" / "game"
CURRICULUM = FFM / "scripts" / "linear-curriculum.mjs"
LEVELS = json.loads((FFM / "app" / "level_data.json").read_text(encoding="utf-8"))["levels"]
LOCALES = ("de", "en")

# The progressive curve (#534) wrote level_data.json with this script; before it
# the levels unlocked operations elsewhere, and the levels card would be wrong.
needs_curve = pytest.mark.skipif(
    not CURRICULUM.exists(), reason="levels card describes the #534 difficulty curve; scripts/linear-curriculum.mjs absent"
)


def read(name: str) -> str:
    return (GAME / name).read_text(encoding="utf-8")


def function_body(source: str, name: str) -> str:
    start = source.index(f"function {name}(")
    end = source.find("\nfunction ", start + 1)
    return source[start:end]


def test_both_locales_carry_the_same_cards():
    for card in ("combat", "combos", "levels"):
        de, en = COPY[card]["de"], COPY[card]["en"]
        assert de.keys() == en.keys(), card
        for key in de:
            if isinstance(de[key], list):
                assert len(de[key]) == len(en[key]), f"{card}.{key}"
    assert len(COPY["combos"]["de"]["tiles"]) == len(COPY["combos"]["tiles"])
    assert len(COPY["levels"]["de"]["steps"]) == len(COPY["levels"]["steps"])


def test_combat_rows_match_the_answer_handlers():
    main = read("main.js")
    right = function_body(main, "handleCorrectAnswer")
    wrong = function_body(main, "handleWrongAnswer")
    # Row 2: a right answer makes the hero attack the fiend.
    assert "strikeNow" in right
    # Row 3: a wrong answer and a timeout both run handleWrongAnswer, which costs a heart.
    assert "state.hearts--" in wrong
    assert "handleWrongAnswer({ timeout: true })" in main
    # Row 4: holding the left edge heals.
    assert "healHoldSecondsPerHeart" in main
    assert "left quarter" in read("i18n.js")


def test_combo_badges_match_the_ability_bands():
    rules = dict(re.findall(r"ability: '(\w+)', minCombo: (\d+)", read("combo-abilities.js")))
    assert set(rules) == {"fireball", "lightning", "dragon"}
    for tile in COPY["combos"]["tiles"]:
        # pickComboAbility fires when combo > minCombo, i.e. on hit minCombo + 1.
        assert tile["combo"] == int(rules[tile["ability"]]) + 1, tile


def test_combo_tile_claims_match_the_game():
    main = read("main.js")
    wrong = function_body(main, "handleWrongAnswer")
    assert "state.combo = 0" in wrong  # footer: one mistake resets the combo
    assert "fiend.hp = 0" in function_body(main, "resolveLightningHit")  # lightning defeats any fiend
    dragon = function_body(main, "finishDragonLevel")  # dragon clears the level
    assert "spawnQueue = []" in dragon and "triggerWaveClear()" in dragon
    fireball = function_body(main, "resolveFireballHit")  # fireball is one ranged hit
    assert "fiend.hit()" in fireball


def unlock_level(op: str) -> int:
    return next(level["level"] for level in LEVELS if op in level["operations"])


@needs_curve
def test_level_steps_match_the_curriculum():
    steps = {step["op"]: step["level"] for step in COPY["levels"]["steps"]}
    assert steps["+"] == unlock_level("+")
    assert steps["-"] == unlock_level("-")
    assert steps["×"] == unlock_level("*")
    assert steps["÷"] == unlock_level("/")
    mixed = next(level for level in LEVELS if level["level"] == steps["+-×÷"])
    assert set(mixed["operations"]) == {"+", "-", "*", "/"}
    assert len(mixed["operations"]) == 4, "from level 40 the four operations are mixed evenly"


@needs_curve
def test_number_range_and_boss_levels_match_the_game():
    cap = COPY["levels"]["operand_cap"]
    assert LEVELS[0]["operandRange"]["a"][1] == cap["first"]
    assert LEVELS[-1]["operandRange"]["a"][1] == cap["last"]
    assert len(LEVELS) == 60
    levels_js = read("levels.js")
    boss = re.search(r"BOSS_ROUND_LEVELS = Object\.freeze\(\[([^\]]+)\]\)", levels_js).group(1)
    assert [int(n) for n in boss.split(",")] == COPY["levels"]["boss_levels"]
    for locale in LOCALES:
        footer = " ".join(COPY["levels"][locale]["footer"])
        assert f"{cap['first']} " in footer and f" {cap['last']}" in footer
        assert ", ".join(str(n) for n in COPY["levels"]["boss_levels"]) in footer


OPS = {"+": "+", "-": "-", "×": "*", "÷": "/"}


def solve(example: str) -> tuple[str, int, int, bool]:
    """'? - 6 = 8' -> ('-', 14, 6, True); '7 × 8' -> ('*', 7, 8, False)."""
    match = re.fullmatch(r"(\?|\d+) ([-+×÷]) (\?|\d+)(?: = (\d+))?", example)
    assert match, example
    a, sign, b, result = match.groups()
    op = OPS[sign]
    hidden = "?" in (a, b)
    if hidden:
        assert result is not None, example
        known, result = int(b if a == "?" else a), int(result)
        inverse = {
            "+": lambda: result - known,
            "-": lambda: result + known if a == "?" else known - result,
            "*": lambda: result // known,
            "/": lambda: result * known if a == "?" else known // result,
        }[op]()
        a, b = (inverse, known) if a == "?" else (known, inverse)
    return op, int(a), int(b), hidden


@needs_curve
def test_each_example_is_a_question_its_level_can_ask():
    missing_from = int(re.search(r"MISSING_OPERAND_FROM_LEVEL = (\d+)", read("levels.js")).group(1))
    for step in COPY["levels"]["steps"]:
        level = next(cfg for cfg in LEVELS if cfg["level"] == step["level"])
        op, a, b, hidden = solve(step["example"])
        assert op in level["operations"], step
        ranges = level.get("operandRangeByOp", {}).get(op, level["operandRange"])
        if op == "/":
            # Division draws the quotient and the divisor from the ranges.
            a = a // b
        assert ranges["a"][0] <= a <= ranges["a"][1], step
        assert ranges["b"][0] <= b <= ranges["b"][1], step
        if op in "+-":
            assert (a + b if op == "+" else a - b) <= level["maxResult"], step
        if hidden:
            assert step["level"] >= missing_from, step


def test_text_stays_short_enough_for_a_thumbnail():
    for locale in LOCALES:
        for row in COPY["combat"][locale]["rows"]:
            assert len(row) <= 34, row
        for tile in COPY["combos"][locale]["tiles"]:
            assert len(tile["name"]) <= 10 and len(tile["text"]) <= 22, tile


def test_cards_render_without_overflow_at_both_store_sizes():
    pytest.importorskip("PIL")
    import sys

    sys.path.insert(0, str(FFM / "store-art" / "tools"))
    try:
        import explainers
    finally:
        sys.path.pop(0)
    try:
        explainers.game_font(20)
    except SystemExit:
        pytest.skip("no Courier-style font installed")
    for locale in LOCALES:
        for size in explainers.SLOTS.values():
            for _, draw in explainers.CARDS:
                # draw() raises LayoutError when any text would overflow or
                # drop below its minimum legible size.
                image = draw(size, COPY, locale)
                assert image.size == size
