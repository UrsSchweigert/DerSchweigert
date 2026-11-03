"""Audio and font asset classes, per-class licences, and per-plan asset directories.

Everything here runs offline: the files are built in the test, so no download and no Blender is involved.
"""
import io
import json
import os
import struct
import wave

import pytest

from harness import humantasks, plans
from harness.assets import AssetService, audio_stats, font_stats, ogg_vorbis_stats, sha256_file, validate_entry, validate_request
from harness_doubles import Env

POLICY = {"assets": plans.DEFAULT_POLICY["assets"], "manual_testing": plans.DEFAULT_POLICY["manual_testing"]}
GODOT_POLICY = plans.with_assets_dir(plans.DEFAULT_POLICY, "apps/arithmoslayer/assets/")


# -- file builders ---------------------------------------------------------------------------------------

def wav_bytes(seconds=0.5, rate=8000, channels=1):
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as handle:
        handle.setnchannels(channels)
        handle.setsampwidth(2)
        handle.setframerate(rate)
        handle.writeframes(b"\x00\x00" * (channels * int(rate * seconds)))
    return buffer.getvalue()


def ogg_page(payload, granule, serial=1, sequence=0):
    lacing, remaining = b"", len(payload)
    while remaining >= 255:
        lacing += b"\xff"
        remaining -= 255
    lacing += bytes([remaining])
    return (b"OggS" + bytes([0, 0]) + struct.pack("<q", granule) + struct.pack("<I", serial) + struct.pack("<I", sequence)
            + struct.pack("<I", 0) + bytes([len(lacing)]) + lacing + payload)


def vorbis_ogg(seconds=1.0, rate=44100, channels=1, serial=1):
    ident = b"\x01vorbis" + struct.pack("<I", 0) + bytes([channels]) + struct.pack("<I", rate) + b"\x00" * 12
    return ogg_page(ident, 0, serial, 0) + ogg_page(b"\x00" * 8, int(round(seconds * rate)), serial, 1)


def font_bytes(tables=None, overrides=None):
    tables = dict(tables if tables is not None else {"head": 16, "cmap": 8, "name": 8, "maxp": 8})
    count = len(tables)
    offset = 12 + 16 * count
    records, body = b"", b""
    for index, (tag, length) in enumerate(tables.items()):
        table_offset = offset
        if overrides and index in overrides:
            table_offset, length = overrides[index]
        records += tag.encode("latin-1").ljust(4) + struct.pack(">III", 0, table_offset, length)
        body += b"\x00" * (length if not (overrides and index in overrides) else 8)
        offset += length
    return struct.pack(">IHHHH", 0x00010000, count, 0, 0, 0) + records + body


def entry_for(root, rel, data, **over):
    path = os.path.join(root, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as handle:
        handle.write(data)
    entry = {"path": rel, "checksum": sha256_file(path), "request_id": "r1", "issue": "i1", "source": "human-supplied", "source_id": "",
             "url": "", "author": "Alice", "license": "CC0-1.0", "attribution": "", "tool": "human-supplied", "tool_version": "",
             "generator": "", "script_ref": "", "prompt": "", "license_file": "", "license_file_checksum": "", "deterministic": True,
             "date": "2026-10-30"}
    entry.update(over)
    return entry


def with_licence(root, entry, text="SIL Open Font License Version 1.1\n" + "Permission is hereby granted. " * 8):
    reference = entry["path"] + ".LICENSE.txt"
    path = os.path.join(root, reference)
    with open(path, "w") as handle:
        handle.write(text)
    return dict(entry, license_file=reference, license_file_checksum=sha256_file(path))


def check(root, data, rel, cls, policy=POLICY, **over):
    return validate_entry(root, entry_for(root, rel, data, **over), policy, cls)


# -- audio ----------------------------------------------------------------------------------------------

def test_wav_reports_seconds_rate_and_channels(tmp_path):
    path = tmp_path / "hit.wav"
    path.write_bytes(wav_bytes(seconds=0.25, rate=22050, channels=2))
    stats = audio_stats(str(path), "wav")
    assert stats["channels"] == 2 and stats["sample_rate_hz"] == 22050 and abs(stats["seconds"] - 0.25) < 0.01


def test_ogg_vorbis_uses_the_last_granule_for_its_length(tmp_path):
    path = tmp_path / "loop.ogg"
    path.write_bytes(vorbis_ogg(seconds=12.0, rate=48000, channels=2))
    stats = ogg_vorbis_stats(str(path))
    assert stats["channels"] == 2 and stats["sample_rate_hz"] == 48000 and abs(stats["seconds"] - 12.0) < 0.001


@pytest.mark.parametrize("data,fragment", [
    (b"ID3\x04\x00\x00\x00\x00\x00\x00", "not an Ogg file"),
    (b"OggS\x00\x00" + b"\x00" * 4, "truncated"),
    (ogg_page(b"\x02vorbis" + b"\x00" * 16, 0), "not a Vorbis identification header"),
    (ogg_page(b"\x01vorbis" + b"\x00" * 4, 0), "truncated Vorbis identification header"),
    (ogg_page(b"\x01vorbis" + struct.pack("<I", 0) + bytes([0]) + struct.pack("<I", 0), 0), "no usable channels"),
    (ogg_page(b"\x01vorbis" + struct.pack("<I", 0) + bytes([1]) + struct.pack("<I", 44100), -1), "no granule position"),
    (ogg_page(b"\x01vorbis" + struct.pack("<I", 0) + bytes([1]) + struct.pack("<I", 44100), 0)
     + ogg_page(b"\x00", 10, serial=2, sequence=1), "chained or multiplexed"),
])
def test_ogg_parsing_fails_closed(tmp_path, data, fragment):
    path = tmp_path / "bad.ogg"
    path.write_bytes(data)
    with pytest.raises(Exception) as error:
        ogg_vorbis_stats(str(path))
    assert fragment in str(error.value)


def test_sound_effect_limits_are_enforced(tmp_path):
    assert check(str(tmp_path), wav_bytes(seconds=0.5), "assets/hit.wav", "audio_sfx") == []
    assert any("exceeds the 3.0 s limit" in f for f in check(str(tmp_path), wav_bytes(seconds=3.5), "assets/hit.wav", "audio_sfx"))
    assert any("sample rate" in f for f in check(str(tmp_path), wav_bytes(rate=96000), "assets/hit.wav", "audio_sfx"))
    assert any("channels" in f for f in check(str(tmp_path), wav_bytes(channels=4), "assets/hit.wav", "audio_sfx"))
    big = json.loads(json.dumps(POLICY))
    big["assets"]["classes"]["audio_sfx"]["max_bytes"] = 100
    assert any("file size" in f for f in check(str(tmp_path), wav_bytes(), "assets/hit.wav", "audio_sfx", policy=big))


def test_the_boundary_of_a_limit_passes(tmp_path):
    assert check(str(tmp_path), wav_bytes(seconds=3.0 * 0.999), "assets/hit.wav", "audio_sfx") == []
    assert check(str(tmp_path), vorbis_ogg(seconds=180.0, rate=48000), "assets/theme.ogg", "audio_music") == []


def test_music_must_be_ogg_and_lingers_inside_its_own_limits(tmp_path):
    assert check(str(tmp_path), vorbis_ogg(seconds=90.0), "assets/theme.ogg", "audio_music") == []
    assert any("exceeds the 180.0 s limit" in f for f in check(str(tmp_path), vorbis_ogg(seconds=200.0), "assets/theme.ogg", "audio_music"))
    assert any("format wav is not allowed" in f for f in check(str(tmp_path), wav_bytes(), "assets/theme.wav", "audio_music"))


def test_audio_requests_must_use_a_format_their_class_allows():
    request = {"request_id": "a1", "issue_id": "i1", "purpose": "theme", "asset_class": "audio_music", "format": "wav",
               "output_path": "assets/theme.wav", "source": "procedural"}
    assert any("not allowed for audio_music" in p for p in validate_request(POLICY, request))
    request["format"], request["output_path"] = "ogg", "assets/theme.ogg"
    assert validate_request(POLICY, request) == []


# -- fonts ---------------------------------------------------------------------------------------------

def test_a_valid_font_passes_and_a_broken_one_fails(tmp_path):
    good = font_bytes()
    entry = with_licence(str(tmp_path), entry_for(str(tmp_path), "assets/ui-font.ttf", good, license="OFL-1.1"))
    assert validate_entry(str(tmp_path), entry, POLICY, "font") == []
    assert any("missing the 'maxp' table" in f
               for f in check(str(tmp_path), font_bytes({"head": 16, "cmap": 8, "name": 8}), "assets/ui-font.ttf", "font", license="OFL-1.1"))
    assert any("not an sfnt font" in f for f in check(str(tmp_path), b"not a font at all", "assets/ui-font.ttf", "font", license="OFL-1.1"))
    assert any("points outside the file" in f
               for f in check(str(tmp_path), font_bytes(overrides={0: (10 ** 6, 16)}), "assets/ui-font.ttf", "font", license="OFL-1.1"))


def test_font_stats_reads_required_tables(tmp_path):
    path = tmp_path / "f.otf"
    path.write_bytes(font_bytes())
    assert set(font_stats(str(path))["tables"]) == {"cmap", "head", "maxp", "name"}


@pytest.mark.parametrize("mutation,fragment", [
    ({"license_file": ""}, "licence text must sit next to the asset"),
    ({"license_file": "assets/sub/OFL.txt", "license_file_checksum": "x"}, "same directory"),
    ({"license_file": "assets/missing.txt", "license_file_checksum": "x"}, "does not exist"),
    ({"license_file_checksum": "0" * 64}, "does not match the checksum"),
])
def test_a_font_must_carry_its_licence_text(tmp_path, mutation, fragment):
    entry = with_licence(str(tmp_path), entry_for(str(tmp_path), "assets/ui-font.ttf", font_bytes(), license="OFL-1.1"))
    fails = validate_entry(str(tmp_path), dict(entry, **mutation), POLICY, "font")
    assert fails and any(fragment in f for f in fails), fails


def test_an_empty_licence_text_is_refused(tmp_path):
    entry = with_licence(str(tmp_path), entry_for(str(tmp_path), "assets/ui-font.ttf", font_bytes(), license="OFL-1.1"), text="OFL")
    assert any("too short" in f for f in validate_entry(str(tmp_path), entry, POLICY, "font"))


# -- per-class licences -----------------------------------------------------------------------------------

def test_a_class_licence_list_overrides_the_global_one(tmp_path):
    font = validate_entry(str(tmp_path), with_licence(str(tmp_path), entry_for(str(tmp_path), "assets/ui-font.ttf", font_bytes(),
                                                                              license="CC0-1.0")), POLICY, "font")
    assert any("not allowed by the policy for font" in f and "OFL-1.1" in f for f in font)
    sprite = check(str(tmp_path), b"\x89PNG\r\n\x1a\n" + b"\x00" * 40, "assets/orb.png", "sprite", license="OFL-1.1")
    assert any("not allowed by the policy for sprite" in f for f in sprite)
    request = {"request_id": "f1", "issue_id": "i1", "purpose": "ui font", "asset_class": "font", "format": "ttf",
               "output_path": "assets/ui-font.ttf", "source": "repository", "library": {"license": "CC0-1.0"}}
    assert any("allowed: ['OFL-1.1', 'Apache-2.0']" in p for p in validate_request(POLICY, request))
    request["library"]["license"] = "Apache-2.0"
    assert validate_request(POLICY, request) == []


# -- asset directory per plan ------------------------------------------------------------------------------

def test_a_plan_can_point_the_asset_directory_at_the_app(tmp_path):
    request = {"request_id": "a1", "issue_id": "i1", "purpose": "hit", "asset_class": "audio_sfx", "format": "wav",
               "output_path": "apps/arithmoslayer/assets/hit.wav", "source": "procedural"}
    assert validate_request(GODOT_POLICY, request, str(tmp_path)) == []
    assert any("inside apps/arithmoslayer/assets/" in p for p in validate_request(GODOT_POLICY, dict(request, output_path="assets/hit.wav")))
    assert any("inside apps/arithmoslayer/assets/" in p for p in validate_request(GODOT_POLICY, dict(request, output_path="../assets/hit.wav")))


@pytest.mark.parametrize("value", ["assets", "/abs/assets/", "../assets/", "", "assets/../..//x/"])
def test_an_unsafe_asset_directory_is_refused(value):
    with pytest.raises(ValueError):
        plans.with_assets_dir(plans.DEFAULT_POLICY, value)
    assert plans.assets_output_dir_problem(value)


def test_the_plan_digest_binds_the_asset_directory():
    from harness import plans as plans_module
    one = plans_module.build_plan("p", 1, [], None, policy=plans_module.with_assets_dir(plans_module.DEFAULT_POLICY, "assets/"))
    two = plans_module.build_plan("p", 1, [], None, policy=GODOT_POLICY)
    assert plans_module.plan_digest(one) != plans_module.plan_digest(two)


def test_output_symlinks_are_refused_inside_a_custom_directory(tmp_path):
    root = tmp_path / "repo"
    (root / "apps/arithmoslayer").mkdir(parents=True)
    outside = tmp_path / "outside"
    outside.mkdir()
    (root / "apps/arithmoslayer/assets").symlink_to(outside)
    request = {"request_id": "a1", "issue_id": "i1", "purpose": "hit", "asset_class": "audio_sfx", "format": "wav",
               "output_path": "apps/arithmoslayer/assets/hit.wav", "source": "procedural"}
    problems = validate_request(GODOT_POLICY, request, str(root))
    assert problems and any("symlink" in p for p in problems)


# -- human fallback -----------------------------------------------------------------------------------------

def service(env, tmp_path, policy=None):
    root = tmp_path / "repo"
    root.mkdir(exist_ok=True)
    return AssetService(env.store, "fx", policy or POLICY, str(root), None, owner="alice", secondary_owner="bob"), root


@pytest.mark.parametrize("asset_class,audio_format,filename", [("audio_sfx", "wav", "hit"), ("audio_music", "ogg", "theme"),
                                                              ("font", "ttf", "ui-font")])
def test_audio_and_font_requests_fall_back_to_a_human_task(tmp_path, asset_class, audio_format, filename):
    env = Env(tmp_path, issues=[("i1", "P1", ["F1.1"])])
    svc, _ = service(env, tmp_path)
    request = {"request_id": "a1", "issue_id": "i1", "purpose": "something audible", "asset_class": asset_class,
               "format": audio_format, "output_path": "assets/%s.%s" % (filename, audio_format), "source": "procedural"}
    result = svc.handle(request, env.clock())
    assert result["status"] == "task_raised" and result["task"] == "asset-a1"
    tasks = [t for t in env.store.human_tasks() if t["task_id"] == "asset-a1"]
    assert len(tasks) == 1 and tasks[0]["payload"]["extra"]["asset_class"] == asset_class


def test_a_human_font_needs_its_licence_text_and_then_records_it(tmp_path):
    env = Env(tmp_path, issues=[("i1", "P1", ["F1.1"])])
    svc, root = service(env, tmp_path)
    svc.handle({"request_id": "a1", "issue_id": "i1", "purpose": "ui font", "asset_class": "font", "format": "ttf",
                "output_path": "assets/ui-font.ttf", "source": "procedural"}, env.clock())
    font = tmp_path / "ui-font.ttf"
    font.write_bytes(font_bytes())
    answers = {"source": "self-made", "license": "OFL-1.1", "author": "Alice"}
    refused = humantasks.respond(env.store, "asset-a1", responder_ids=["alice"], source="local", now=env.clock(),
                                 answers=answers, artifacts=[str(font)], asset_handler=svc.accept_human_asset)
    assert refused["status"] == "invalid" and "licence text" in refused["reason"]
    assert not (root / "assets/ui-font.ttf").exists()

    licence = tmp_path / "OFL-LICENSE.txt"
    licence.write_text("SIL Open Font License, Version 1.1\n" + "Permission is hereby granted, free of charge. " * 10)
    accepted = humantasks.respond(env.store, "asset-a1", responder_ids=["alice"], source="local", now=env.clock(),
                                  answers=answers, artifacts=[str(font), str(licence)], asset_handler=svc.accept_human_asset)
    assert accepted["status"] == "resolved", accepted
    entry = svc.manifest()["entries"][0]
    assert entry["license"] == "OFL-1.1" and entry["license_file"] == "assets/ui-font.ttf.LICENSE.txt"
    assert entry["license_file_checksum"] == sha256_file(str(root / "assets/ui-font.ttf.LICENSE.txt"))


# -- the policy itself ----------------------------------------------------------------------------------

def test_the_default_policy_carries_the_new_classes_and_paths():
    classes = plans.DEFAULT_POLICY["assets"]["classes"]
    assert {"audio_sfx", "audio_music", "font"} <= set(classes)
    assert classes["audio_music"]["formats"] == ["ogg"] and classes["audio_sfx"]["formats"] == ["wav", "ogg"]
    assert classes["font"]["allowed_licenses"] == ["OFL-1.1", "Apache-2.0"]
    assert plans.DEFAULT_POLICY["assets"]["allowed_licenses"] == ["CC0-1.0"]
    assert plans.DEFAULT_POLICY["assets"]["paid_generation_credits"] == 0
    assert "ai" not in plans.DEFAULT_POLICY["assets"]["allowed_sources"]
    for path in ("export_presets.cfg", "addons/", "apps/arithmoslayer/android/", "*.gdextension", "*.so"):
        assert path in plans.DEFAULT_POLICY["escalation_paths"]


def test_plan_validation_refuses_an_unusable_asset_policy():
    plan = plans.build_plan("p", 1, [{"id": "A1", "title": "t", "source": "s"}], [{
        "id": "P1", "outcomes": ["o"], "requirements": ["A1"], "path_allowlist": ["apps/"], "non_goals": ["n"],
        "exit_criteria": ["e"], "validation": ["true"], "dependencies": [], "working_directory": "."}], policy=plans.DEFAULT_POLICY)
    assert plans.validate_plan(plan) == []
    broken = json.loads(json.dumps(plan))
    broken["policy"]["assets"]["output_dir"] = "assets"
    assert any("output_dir must end with" in p for p in plans.validate_plan(broken))
    broken = json.loads(json.dumps(plan))
    broken["policy"]["assets"]["classes"]["font"] = {"formats": []}
    assert any("needs a list of allowed formats" in p for p in plans.validate_plan(broken))
    broken = json.loads(json.dumps(plan))
    broken["policy"]["assets"]["classes"]["font"] = {"formats": ["ttf"], "allowed_licenses": []}
    assert any("allowed_licenses must not be empty" in p for p in plans.validate_plan(broken))
