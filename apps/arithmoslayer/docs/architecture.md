# Arithmo Slayer — project layout

Arithmo Slayer is a Godot 4.7.2 game that lives entirely in `apps/arithmoslayer/`.
The browser game in the sibling site tree is a separate product: this project
never imports from it, never links to it, and never mentions its path.

## Directories

| Path | Purpose |
| --- | --- |
| `scenes/` | Packed scenes. `scenes/main.tscn` is the only scene in the skeleton and is the main scene. |
| `scripts/` | Typed GDScript. `scripts/main.gd` drives the root scene and `scripts/autoload/` holds autoloads. |
| `data/` | Data-driven content: `data/i18n/` for translations and `data/project/` for project-wide data files. |
| `shaders/` | Reserved for Godot shaders (`.gdshader`); created with the first shader. |
| `assets/` | Reserved for art, audio, and font sources; created with the first asset. |
| `test/` | GUT tests. `test/unit/` holds unit tests and `test/fixtures/` holds shared fixtures. |
| `docs/` | Architecture, installation, and testing notes. |
| `tools/` | Python guard scripts (`check_isolation.py`, `check_offline.py`) and later build helpers. |

Every directory stays inside `apps/arithmoslayer/`. Changes elsewhere in the
repository are rejected by `tools/check_isolation.py`.

## Autoloads

The autoload list is deliberately short. Each entry is registered in
`project.godot` and asserted by `test/unit/test_project_config.gd`.

| Autoload | Script | Responsibility |
| --- | --- | --- |
| `GameState` | `res://scripts/autoload/game_state.gd` | Session score shared between scenes. |

Add an autoload only when several scenes need the same state, and update this
table, `project.godot`, and the autoload test in the same change.

## Project settings

- `application/config/features` pins the `4.7` feature set with the
  `GL Compatibility` renderer, which is the portable choice for Android and
  desktop.
- `debug/gdscript/warnings/untyped_declaration` is `2`, so every untyped
  declaration is a parse error. All project scripts declare parameter,
  variable, and return types.
- `engine-version.txt` records the supported engine (`4.7.2-stable`); see
  `docs/install.md`.

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

## Tests

GUT tests live under `test/` and run with `godot-test .` from this directory.
See `docs/testing.md` for the full local workflow.
