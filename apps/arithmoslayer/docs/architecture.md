# Arithmo Slayer — project layout

Arithmo Slayer is a Godot 4.7.2 game that lives entirely in `apps/arithmoslayer/`.
The browser game in the sibling site tree is a separate product: this project
never imports from it, never links to it, and never mentions its path.

## Directories

| Path | Purpose |
| --- | --- |
| `scenes/` | Packed scenes. `scenes/main.tscn` is the main scene; `scenes/ui/root.tscn` is the safe-area UI root it instances. |
| `scripts/` | Typed GDScript. `scripts/main.gd` drives the root scene, `scripts/autoload/` holds autoloads, and `scripts/ui/safe_area.gd` applies the display safe area. |
| `data/` | Data-driven content: `data/i18n/strings.csv` holds the `key,en,de` translation table, `data/android_targets.json` records the Android SDK levels and permissions, and `data/project/` holds project-wide data files. |
| `shaders/` | Reserved for Godot shaders (`.gdshader`); created with the first shader. |
| `assets/` | Reserved for art, audio, and font sources; created with the first asset. |
| `test/` | GUT tests. `test/unit/` holds unit tests and `test/fixtures/` holds shared fixtures. |
| `docs/` | Architecture, installation, testing, and Android release notes (`docs/android.md`). |
| `tools/` | Python guard scripts. `validate_data.py` is the single data-validation entry point and discovers the per-data-type modules under `tools/validate/`; `check_isolation.py` and `check_offline.py` guard the project boundary and network policy. |

Every directory stays inside `apps/arithmoslayer/`. Changes elsewhere in the
repository are rejected by `tools/check_isolation.py`.

## Autoloads

The autoload list is deliberately short. Each entry is registered in
`project.godot` and asserted by `test/unit/test_project_config.gd`.

| Autoload | Script | Responsibility |
| --- | --- | --- |
| `GameState` | `res://scripts/autoload/game_state.gd` | Session score shared between scenes. |
| `Localization` | `res://scripts/autoload/localization.gd` | Loads `data/i18n/strings.csv`, picks the device language with English fallback, and exposes `tr_key()`. |

Add an autoload only when several scenes need the same state, and update this
table, `project.godot`, and the autoload test in the same change.

## Localization

`data/i18n/strings.csv` is the single source of every user-visible string. The
first column holds the key and the remaining columns hold the `en` and `de`
translations; a key must have a value in both languages. The `Localization`
autoload parses the table at startup, selects the device language when it is
supported (`de_DE` resolves to `de`), falls back to `en` otherwise, and exposes
the typed lookup `tr_key(key: StringName) -> String`. An unknown key returns the
key itself so a missing translation is visible instead of blank.

`scripts/core/localization/localization.gd` holds the reusable table parser;
the autoload is the thin scene-facing wrapper. `tools/validate_data.py` checks
the table shape, reports a missing key with its file and field, and verifies
that every `tr_key()` reference in `scripts/` and `scenes/` resolves.

## Project settings

- `application/config/name` is `Arithmoslayer`, and
  `application/config/android_package` records the Play package id
  `de.derschweigert.arithmoslayer` for the human-owned export preset.
- `application/config/version` mirrors `versionName` from `VERSION`;
  `VERSION` also holds `versionCode`.
- `display/window/handheld/orientation` is `0` (landscape), so phones and
  tablets both start in landscape.
- `application/config/features` pins the `4.7` feature set with the
  `GL Compatibility` renderer, which is the portable choice for Android and
  desktop.
- `debug/gdscript/warnings/untyped_declaration` is `2`, so every untyped
  declaration is a parse error. All project scripts declare parameter,
  variable, and return types.
- `engine-version.txt` records the supported engine (`4.7.2-stable`); see
  `docs/install.md`.

## App identity and Android target

`VERSION` is the single source of `versionName` and `versionCode`, and
`data/android_targets.json` records `minSdk` `24`, `targetSdk` `36`, the only
allowed permission (`com.android.vending.BILLING`), and a source note for the
SDK levels. `scripts/ui/safe_area.gd` reads
`DisplayServer.get_display_safe_area()` and applies the insets as margins on
the `scenes/ui/root.tscn` control, so the shell stays inside the usable screen
area in landscape. `test/unit/test_app_identity.gd` guards all of these
values and the safe-area maths. `docs/android.md` documents the export preset
and manifest steps that the release owner performs by hand; the repository
intentionally contains no export preset, build template, or signing material.

## Isolation from the browser game

`tools/check_isolation.py` reports the changed paths in the working tree and
the commits on the current branch. It fails when a changed path lies outside
`apps/arithmoslayer/` or when a project file references the browser game's
site path. The repository root is discovered with `git rev-parse`, so the
script also works when the project is copied to a temporary directory without
a `.git` folder.

## Offline first

`tools/check_offline.py` scans project text files and fails when they use any
of Godot's HTTP or WebSocket client classes, or when they request an Android
permission other than `com.android.vending.BILLING`. The game ships its
content and does not need a network connection to play.

## Save system

`scripts/core/save/save_system.gd` and `scripts/core/save/migrations.gd` own
per-profile persistence. Every profile carries a `schema_version`; saves are
written to a `.tmp` file and renamed into place after the previous file is
moved aside as a `.bak` backup, so an interrupted or corrupt write can recover
from the last good profile. `SaveMigrations` lists one migration per schema
version below `CURRENT_SCHEMA_VERSION`, and `SaveSystem.load` migrates a
profile up to the current version, falling back to the `.bak` and reporting the
recovery when the target is corrupt. `test/unit/test_save_system.gd` and the
fixtures in `test/fixtures/saves/` guard atomic writes, backup recovery, and
migrations.

## Determinism

`scripts/core/rng.gd` is the only script allowed to call Godot's global
randomness. The `Rng` class wraps `RandomNumberGenerator`, takes an injected
seed in `Rng.new(seed)`, can be reseeded with `set_seed()`, and delegates
`randf()`, `randf_range()`, `randi()`, and `randi_range()`, so two instances
with the same seed produce the same sequence. `scripts/core/timestep.gd`
defines `Timestep.FIXED_DELTA = 1.0 / 60.0` as the fixed simulation step.
`test/unit/test_determinism.gd` checks both and scans `scripts/` for direct
`randi`, `randf`, or `randomize` calls, failing with each `file:line`.

## Tests

GUT tests live under `test/` and run with `godot-test .` from this directory.
See `docs/testing.md` for the full local workflow.
