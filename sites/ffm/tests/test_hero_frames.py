"""hero_frames.py --hero: output paths, the 28-frame rule, weapon checks, anchors, hair softening."""
import importlib.util
import re
import sys
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("hero_frames", ROOT / "scripts" / "hero_frames.py")
hero_frames = importlib.util.module_from_spec(SPEC)
sys.modules["hero_frames"] = hero_frames  # dataclasses look their module up while it loads
SPEC.loader.exec_module(hero_frames)

DENIM = (40, 52, 96, 255)
SKIN_DARK = (140, 100, 90, 255)
HAND = (230, 150, 110, 255)
POLE = (150, 110, 60, 255)
HAIR = (220, 170, 60, 255)
OUTLINE = (16, 18, 34, 255)


def make_frame(clip, index, weapon=None):
    """A 100x120 standing figure; swing frames carry the weapon, cast frames a hand."""
    img = np.zeros((120, 100, 4), np.uint8)
    img[40:116, 30:60] = DENIM
    img[20:40, 36:54] = SKIN_DARK
    if clip == "swing" and weapon in ("staff", "bow") and index in (2, 3):
        img[10:100, 85:88] = POLE
    if clip == "swing" and weapon == "fist" and index == 2:
        img[55:62, 60:95] = DENIM
    if clip == "cast" and index in (2, 3):
        x = 70 + 4 * (index - 2)
        img[50:56, x:x + 6] = HAND
        img[52:54, 60:x] = DENIM
    return Image.fromarray(img, "RGBA")


def write_frames(directory, weapon=None, skip=()):
    directory.mkdir(parents=True, exist_ok=True)
    for clip, count in hero_frames.CLIP_FRAMES.items():
        for index in range(1, count + 1):
            if f"{clip}-{index}" not in skip:
                make_frame(clip, index, weapon).save(directory / f"{clip}-{index}.png")
    return directory


@pytest.fixture
def heroes_dir(tmp_path, monkeypatch):
    out = tmp_path / "heroes"
    monkeypatch.setattr(hero_frames, "HEROES_DIR", out)
    return out


def run(*argv):
    return hero_frames.main([str(a) for a in argv])


def test_hero_build_writes_atlas_and_module_under_the_hero_dir(tmp_path, heroes_dir):
    frames = write_frames(tmp_path / "frames", "staff")
    assert run("--from-frames", frames, "--hero", "monk", "--weapon", "staff") == 0
    atlas = heroes_dir / "monk" / "hero-atlas.webp"
    module = (heroes_dir / "monk" / "hero-frames.js").read_text(encoding="utf-8")
    assert Image.open(atlas).format == "WEBP"
    assert "export const HERO_ATLAS" in module and "export const HERO_FRAMES" in module
    assert len(re.findall(r"^  '[a-z]+-\d': ", module, re.M)) == 28
    assert re.search(r"export const HERO_ANCHORS = \{\"strike\": \[-?\d+, -?\d+\], \"cast\": "
                     r"\[\[-?\d+, -?\d+\], \[-?\d+, -?\d+\]\]\};", module)


def test_without_hero_the_old_paths_are_used(tmp_path, monkeypatch, heroes_dir):
    monkeypatch.setattr(hero_frames, "OUT_ATLAS", tmp_path / "old" / "hero-atlas.webp")
    monkeypatch.setattr(hero_frames, "OUT_META", tmp_path / "old" / "hero-frames.js")
    assert run("--from-frames", write_frames(tmp_path / "frames")) == 0
    assert (tmp_path / "old" / "hero-frames.js").is_file()
    assert "HERO_ANCHORS" not in (tmp_path / "old" / "hero-frames.js").read_text(encoding="utf-8")
    assert not heroes_dir.exists()


def test_a_missing_frame_is_an_error_and_nothing_is_written(tmp_path, heroes_dir):
    frames = write_frames(tmp_path / "frames", "staff", skip=("cast-4",))
    assert run("--from-frames", frames, "--hero", "monk", "--weapon", "staff") == 1
    assert not heroes_dir.exists()


@pytest.mark.parametrize("argv", [
    ["--hero", "wizard", "--weapon", "staff"],
    ["--hero", "monk"],
    ["--weapon", "staff"],
])
def test_bad_hero_arguments_are_rejected(tmp_path, heroes_dir, argv):
    frames = write_frames(tmp_path / "frames", "staff")
    with pytest.raises(SystemExit):
        run("--from-frames", frames, *argv)
    assert not heroes_dir.exists()


@pytest.mark.parametrize("weapon", ["bow", "staff", "fist"])
def test_weapon_present_passes(tmp_path, heroes_dir, weapon):
    assert run("--from-frames", write_frames(tmp_path / "f", weapon), "--hero", "rogue",
               "--weapon", weapon, "--check") == 0


@pytest.mark.parametrize("weapon", ["bow", "staff", "fist"])
def test_weapon_missing_fails(tmp_path, heroes_dir, weapon):
    assert run("--from-frames", write_frames(tmp_path / "f"), "--hero", "rogue",
               "--weapon", weapon, "--check") == 1
    assert not heroes_dir.exists()


@pytest.mark.parametrize("weapon", ["sword", "buckler"])
def test_sword_and_buckler_run_the_blade_line_check(tmp_path, heroes_dir, capsys, weapon):
    run("--from-frames", write_frames(tmp_path / "f"), "--hero", "soldier", "--weapon", weapon, "--check")
    out = capsys.readouterr().out
    assert "sword check" in out and "weapon check" not in out


def test_anchors_are_detected_and_can_be_overridden(tmp_path, heroes_dir, capsys):
    frames = write_frames(tmp_path / "f", "staff")
    run("--from-frames", frames, "--hero", "monk", "--weapon", "staff")
    module = (heroes_dir / "monk" / "hero-frames.js").read_text(encoding="utf-8")
    anchors = hero_frames.detect_anchors(hero_frames.collect_from_frames(frames)[0], "staff")
    strike_x, strike_y = anchors["strike"]
    assert strike_x > 20 and strike_y < -60, "the staff tip is up and to the right of the feet"
    assert 2 <= anchors["cast"][1][0] - anchors["cast"][0][0] <= 6
    assert "detected anchors" in capsys.readouterr().out
    assert f'"strike": [{strike_x}, {strike_y}]' in module

    run("--from-frames", frames, "--hero", "monk", "--weapon", "staff",
        "--strike-anchor", "70,-55", "--cast-anchors", "100,-122,94,-126")
    module = (heroes_dir / "monk" / "hero-frames.js").read_text(encoding="utf-8")
    assert 'HERO_ANCHORS = {"strike": [70, -55], "cast": [[100, -122], [94, -126]]};' in module


def test_contact_sheet_is_written(tmp_path, heroes_dir):
    sheet = tmp_path / "out" / "contact.png"
    run("--from-frames", write_frames(tmp_path / "f", "staff"), "--hero", "monk", "--weapon", "staff",
        "--contact-sheet", sheet)
    assert Image.open(sheet).height > 7 * 100


# ── hair softening ───────────────────────────────────────────────────────────
def head(spikes=True):
    """A round golden head with an outline, optionally with three thin spikes on top."""
    hair = np.zeros((70, 70), bool)
    yy, xx = np.mgrid[0:70, 0:70]
    hair |= (xx - 35) ** 2 + (yy - 40) ** 2 <= 14 ** 2
    if spikes:
        for x in (26, 35, 44):
            hair[8:30, x:x + 3] = True
    img = np.zeros((70, 70, 4), np.uint8)
    ring = hair | np.roll(hair, 1, 0) | np.roll(hair, -1, 0) | np.roll(hair, 1, 1) | np.roll(hair, -1, 1)
    img[ring] = OUTLINE
    img[hair] = HAIR
    img[58:68, 28:42] = DENIM          # a body under the head, outside the hair
    return img, hair


def test_thin_spikes_are_removed():
    img, _ = head()
    out = hero_frames.soften_hair(img)
    assert not out[:24].any(), "spikes above the head are gone"
    assert out[40, 35, 3] and out[60, 35, 3], "the head and the body stay"


def test_a_round_head_is_unchanged():
    img, _ = head(spikes=False)
    assert np.array_equal(hero_frames.soften_hair(img), img)


def test_only_hair_and_its_outline_change():
    img, hair = head()
    out = hero_frames.soften_hair(img)
    near = hair | np.roll(hair, 1, 0) | np.roll(hair, -1, 0) | np.roll(hair, 1, 1) | np.roll(hair, -1, 1)
    changed = (out != img).any(axis=2)
    assert changed.any() and not (changed & ~near).any()


def test_a_second_pass_changes_nothing():
    img, _ = head()
    once = hero_frames.soften_hair(img)
    assert np.array_equal(hero_frames.soften_hair(once), once)


def test_no_hole_is_opened_inside_the_figure():
    img, _ = head()
    img[38:40, 30:40] = 0                       # a seam cut into the head
    before = hero_frames._holes(img[:, :, 3] > 0)
    out = hero_frames.soften_hair(img)
    assert hero_frames._holes(out[:, :, 3] > 0) <= before


def test_a_frame_without_hair_passes_through():
    img = np.zeros((40, 40, 4), np.uint8)
    img[5:35, 10:30] = DENIM
    assert np.array_equal(hero_frames.soften_hair(img), img)
    assert hero_frames.hair_measures(img) is None


def test_measures_improve_for_spiky_hair():
    img, _ = head()
    before = hero_frames.hair_measures(img)
    after = hero_frames.hair_measures(hero_frames.soften_hair(img))
    assert after["solidity"] > before["solidity"] and after["bbox"][1] > before["bbox"][1]


def test_style_reference_is_a_magenta_plate_x4(tmp_path):
    atlas = tmp_path / "atlas"
    atlas.mkdir()
    img, _ = head()
    Image.fromarray(img, "RGBA").save(atlas / "hero-atlas.webp", lossless=True)
    (atlas / "hero-frames.js").write_text(
        "export const HERO_FRAMES = {\n  'idle-1': { x: 0, y: 0, w: 70, h: 70, px: 35, py: 69, shadow: 0 },\n};\n")
    out = tmp_path / "plate.png"
    assert run("--style-reference", out, "--style-from", atlas) == 0
    plate = np.array(Image.open(out))
    assert plate.shape == (280, 280, 3)
    assert tuple(plate[0, 0]) == (255, 0, 255)
    assert tuple(plate[0, 140]) == (255, 0, 255), "the spike is gone, the plate shows"



def test_softening_stays_at_the_edge_of_todays_atlas():
    img = hero_frames.load_atlas_frame(hero_frames.STYLE_DEFAULT_DIR)
    out = hero_frames.soften_hair(img)
    near_background = hero_frames._grow(np.pad(img[:, :, 3] == 0, 8, constant_values=True), 7)[8:-8, 8:-8]
    changed = (out != img).any(axis=2)
    assert changed.any() and not (changed & ~near_background).any(), "the face is never eaten"
