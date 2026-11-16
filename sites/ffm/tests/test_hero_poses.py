"""cut_pose: the backdrop, the gaps between limbs and the contact shadow go; the hero stays."""
import importlib.util
import sys
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "hero_poses.py"
SPEC = importlib.util.spec_from_file_location("hero_poses", SCRIPT)
hero_poses = importlib.util.module_from_spec(SPEC)
sys.modules["hero_poses"] = hero_poses  # dataclasses look their module up while it loads
SPEC.loader.exec_module(hero_poses)

BODY = (40, 52, 96)        # denim
BOOT = (34, 24, 20)        # near-black leather
STEEL = (168, 180, 204)    # bluish blade grey
EYE = (248, 248, 248)      # eye white, same as a white plate

PLATES = {"white": (250, 250, 250), "magenta": (255, 0, 255)}


def scene(plate):
    """A 240x240 cell: body with an arm loop around a plate-coloured gap, an eye, boots,
    a blade reaching the ground, and a contact shadow under the boots."""
    plate = np.array(plate)
    img = np.zeros((240, 240, 3), np.uint8)
    img[:] = plate
    # contact shadow: an ellipse of the plate seen in shade, under and between the boots
    yy, xx = np.mgrid[0:240, 0:240]
    shadow = ((xx - 110) / 70.0) ** 2 + ((yy - 212) / 9.0) ** 2 <= 1
    img[shadow] = (plate * 0.6).astype(np.uint8)
    img[40:200, 80:140] = BODY                       # torso and legs
    img[60:110, 140:190] = BODY                      # arm loop ...
    img[72:98, 150:178] = plate                      # ... around a gap of plate
    img[50:52, 100:102] = EYE                        # a small white eye (below the gap size threshold)
    img[196:212, 78:102] = BOOT                      # boots on the ground line
    img[196:212, 118:142] = BOOT
    for i in range(70):                              # blade from the hand down to the ground
        img[146 + i, 170 + i // 3:176 + i // 3] = STEEL
    return Image.fromarray(img, "RGB"), shadow


def cut(plate):
    image, _ = scene(plate)
    report = hero_poses.CutReport()
    return hero_poses.cut_mask(image, report), report


@pytest.mark.parametrize("plate", PLATES.values(), ids=PLATES.keys())
def test_the_gap_between_arm_and_body_becomes_transparent(plate):
    alpha, report = cut(plate)
    assert not alpha[75:95, 153:175].any(), "the enclosed gap must be cut, not filled"
    assert report.pockets >= 26 * 28 * 0.8
    assert alpha[65, 145] and alpha[105, 185], "the arm around the gap stays"


@pytest.mark.parametrize("plate", PLATES.values(), ids=PLATES.keys())
def test_the_eye_white_and_the_blade_tip_survive(plate):
    alpha, _ = cut(plate)
    assert alpha[50:52, 100:102].all(), "a small white highlight is art, not a gap"
    assert alpha[210, 194:198].any(), "the blade tip reaching the ground is steel, not shadow"


@pytest.mark.parametrize("plate", PLATES.values(), ids=PLATES.keys())
def test_the_contact_shadow_is_removed_and_the_boots_stay(plate):
    alpha, report = cut(plate)
    _, shadow = scene(plate)
    figure_rows = np.zeros_like(shadow)
    figure_rows[196:212, 78:102] = figure_rows[196:212, 118:142] = True
    left_over = alpha & shadow & ~figure_rows
    left_over[:, 160:] = False  # the blade crosses the shadow on the right
    assert left_over.sum() == 0, f"{left_over.sum()} shadow pixels left"
    assert report.shadow > 300
    assert alpha[200:210, 82:98].all() and alpha[200:210, 122:138].all(), "the boots stay"


def test_the_backdrop_colour_is_read_from_the_cell():
    image, _ = scene(PLATES["magenta"])
    report = hero_poses.CutReport()
    hero_poses.cut_pose(image, report)
    assert report.backdrop == (255, 0, 255)


def test_an_empty_cell_is_an_error():
    with pytest.raises(ValueError, match="nothing left"):
        hero_poses.cut_pose(Image.new("RGB", (64, 64), (255, 0, 255)))


def test_a_narrow_gap_on_a_chroma_plate_is_cut_too():
    """A sliver of plate between thigh and blade is too small for the white-plate guard, but on
    magenta nothing on the hero shares the plate's hue, so it is a gap all the same."""
    image, _ = scene(PLATES["magenta"])
    img = np.array(image)
    img[150:153, 100:120] = PLATES["magenta"]   # a 3px slit through the legs, enclosed by denim
    alpha = hero_poses.cut_mask(Image.fromarray(img))
    assert not alpha[151, 102:118].any()


def test_despill_takes_the_plate_tint_off_the_edge_only():
    rgb = np.zeros((20, 20, 3), np.uint8)
    rgb[:] = BODY
    rgb[5, 2] = (150, 40, 160)                      # an outline pixel mixed with magenta
    rgb[10, 10] = (70, 50, 66)                      # mild purple shading deep inside: art, left alone
    rgb[12, 12] = (200, 40, 210)                    # strong plate colour leaking into a seam inside
    figure = np.zeros((20, 20), bool)
    figure[2:18, 2:18] = True
    out, count = hero_poses.despill(rgb, figure, np.array([255.0, 0.0, 255.0]))
    assert tuple(out[5, 2]) == (40, 40, 50), "the edge loses all of the tint"
    assert tuple(out[10, 10]) == (70, 50, 66), "the art's own mild purple stays"
    assert tuple(out[12, 12]) == (64, 40, 74) and count == 2, "a seam keeps only the art's allowance"
    assert hero_poses.despill(rgb, figure, np.array([250.0, 250.0, 250.0]))[1] == 0
