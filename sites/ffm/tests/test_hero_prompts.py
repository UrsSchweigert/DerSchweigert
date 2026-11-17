"""hero_prompts: one fixed template, ten roster heroes, eight sheets, no wording a reviewer would reject."""
import importlib.util
import re
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("hero_prompts", ROOT / "scripts" / "hero_prompts.py")
hp = importlib.util.module_from_spec(SPEC)
sys.modules["hero_prompts"] = hp
SPEC.loader.exec_module(hp)

ALL = hp.build_all()


def test_eighty_unique_deterministic_prompts():
    assert len(ALL) == 80 and len({k for k, _ in ALL}) == 80
    assert ALL == hp.build_all()


@pytest.mark.parametrize("key,text", ALL)
def test_rules(key, text):
    hero, sheet = key.split(":")
    assert not hp.FORBIDDEN.search(text)
    assert len(text) < 1500
    for rule in ("flat single-colour backdrop", "no shadow", "no text"):
        assert rule in text
    if sheet != "portrait":
        assert "2x2 grid" in text and "facing right" in text
    assert ("no arrow in flight" in text) == (sheet == "swing" and hero in ("rogue", "rogue-f"))


def test_adventurer_hair_and_idle_variants():
    assert "short, softly tousled golden-blonde hair with at most three small rounded tufts" in hp.prompt("adventurer", "idle")
    assert "Keep the reference figure" in hp.prompt("adventurer", "idle")
    assert "Draw a new figure" in hp.prompt("monk", "idle")
    assert "spik" not in " ".join(t for _, t in ALL).lower()


def test_poses_mirror_clips():
    text = hp.prompt("soldier", "swing")
    for word in ("windup", "strike", "impact", "follow-through", "arming sword"):
        assert word in text
    for word in ("gather", "thrust", "hold", "recover", "casting hand"):
        assert word in hp.prompt("princess-armed", "cast")
    bow = hp.prompt("rogue-f", "swing")
    assert "loose" in bow and "recover" in bow


def test_cli(capsys):
    assert hp.main(["--hero", "monk", "--sheet", "portrait"]) == 0
    assert capsys.readouterr().out.strip() == hp.prompt("monk", "portrait")
    assert hp.main(["--list"]) == 0
    assert len(capsys.readouterr().out.splitlines()) == 80
    assert hp.main(["--check"]) == 0
    with pytest.raises(SystemExit):
        hp.main(["--hero", "wizard", "--sheet", "idle"])
