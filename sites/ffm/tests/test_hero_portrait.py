"""hero_portrait: the avatar recipe and its refusals."""
import importlib.util
import io
import sys
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "hero_portrait.py"
SPEC = importlib.util.spec_from_file_location("hero_portrait", SCRIPT)
hp = importlib.util.module_from_spec(SPEC)
sys.modules["hero_portrait"] = hp
SPEC.loader.exec_module(hp)


@pytest.fixture
def heroes_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(hp, "HEROES_DIR", tmp_path / "heroes")
    return tmp_path / "heroes"


@pytest.fixture
def bust(tmp_path):
    path = tmp_path / "bust.png"
    hp.synthetic_bust().save(path)
    return path


def test_roster_ids_in_order():
    ids = hp.roster_ids()
    assert ids[0] == "adventurer" and len(ids) == 10 and "priestess" == ids[-1]


def test_key_uses_chroma_rule():
    px = np.array([[[255, 0, 255], [200, 160, 200], [250, 20, 240], [20, 200, 20]]], np.uint8)
    assert hp.key_magenta(px).tolist() == [[False, True, False, True]]


def test_only_largest_blob_survives():
    mask = np.zeros((60, 60), bool)
    mask[10:40, 10:40] = True
    mask[50:55, 50:55] = True
    cleaned = hp.clean_mask(mask)
    assert cleaned[20, 20] and not cleaned[52, 52]


def test_recipe_properties():
    out = np.asarray(hp.build_portrait(hp.synthetic_bust()))
    assert out.shape == (256, 256, 4)
    assert set(np.unique(out[..., 3])) == {0, 255}
    blocks = out.reshape(64, 4, 64, 4, 4)
    assert np.all(blocks == blocks[:, :1, :, :1, :])
    assert len({tuple(p[:3]) for p in out[out[..., 3] == 255]}) <= 28
    assert out[..., 3].reshape(64, 4, 64, 4).max(axis=(1, 3)).astype(bool).sum(axis=1).max() <= 55


def test_check_passes(capsys):
    assert hp.main(["--check"]) == 0


def test_hero_writes_only_the_portrait(heroes_dir, bust):
    assert hp.main(["--hero", "rogue", "--from", str(bust)]) == 0
    files = sorted(p.relative_to(heroes_dir).as_posix() for p in heroes_dir.rglob("*") if p.is_file())
    assert files == ["rogue/portrait.webp"]
    hp.validate((heroes_dir / "rogue" / "portrait.webp").read_bytes())


def test_unknown_hero_rejected(heroes_dir, bust):
    assert hp.main(["--hero", "wizard", "--from", str(bust)]) == 1
    assert not heroes_dir.exists()


def test_empty_figure_refused(heroes_dir, tmp_path):
    plate = tmp_path / "plate.png"
    Image.new("RGB", (100, 100), (255, 0, 255)).save(plate)
    assert hp.main(["--hero", "rogue", "--from", str(plate)]) == 1
    assert not heroes_dir.exists()


def test_oversize_refused(heroes_dir, bust, monkeypatch):
    monkeypatch.setattr(hp, "MAX_BYTES", 100)
    assert hp.main(["--hero", "rogue", "--from", str(bust)]) == 1
    assert not heroes_dir.exists()


def encoded(image):
    buf = io.BytesIO()
    image.save(buf, "WEBP", lossless=True)
    return buf.getvalue()


def test_validate_refusals():
    with pytest.raises(hp.PortraitError, match="not 256x256"):
        hp.validate(encoded(Image.new("RGBA", (128, 128), (1, 2, 3, 255))))
    with pytest.raises(hp.PortraitError, match="partial alpha"):
        hp.validate(encoded(Image.new("RGBA", (256, 256), (1, 2, 3, 128))))
    with pytest.raises(hp.PortraitError, match="empty"):
        hp.validate(encoded(Image.new("RGBA", (256, 256), (0, 0, 0, 0))))


def test_reference_plate(tmp_path):
    frame = tmp_path / "idle-1.png"
    img = Image.new("RGBA", (3, 2), (0, 0, 0, 0))
    img.putpixel((1, 0), (10, 20, 30, 255))
    img.save(frame)
    out = tmp_path / "plate.png"
    assert hp.main(["--reference", str(frame), "--out", str(out)]) == 0
    plate = Image.open(out).convert("RGB")
    assert plate.size == (12, 8)
    assert plate.getpixel((0, 0)) == (255, 0, 255)
    assert plate.getpixel((7, 3)) == (10, 20, 30)


def test_contact_sheet_skips_missing(heroes_dir, bust, tmp_path):
    hp.main(["--hero", "monk", "--from", str(bust)])
    hp.main(["--hero", "rogue", "--from", str(bust)])
    out = tmp_path / "sheet.png"
    assert hp.write_contact_sheet(out) == ["rogue", "monk"]
    sheet = Image.open(out)
    assert sheet.getpixel((0, 0)) == hp.SHEET_BG
    assert sheet.width == 96 * 2


def test_contact_sheet_needs_a_portrait(heroes_dir, tmp_path):
    assert hp.main(["--contact-sheet", str(tmp_path / "s.png")]) == 1
