# Testing Arithmo Slayer

All tests are GUT 9.6 tests under `test/` and run headless.

## Run everything

```sh
cd apps/arithmoslayer
godot-test .
```

`godot-test` copies the project to a temporary directory, adds the image's GUT
copy as `addons/gut/`, imports the project headless, and runs every test under
`test/` including subdirectories.

## Run a single file

```sh
godot-test . -gtest=res://test/unit/test_project_config.gd
```

## What the suite covers

| Test file | Guards |
| --- | --- |
| `test/unit/test_project_config.gd` | Engine pin, `4.7` feature set, untyped-declaration errors, the autoload list, and the main scene. |
| `test/unit/test_localization.gd` | The translation table, the English/German key sets, device-language selection with English fallback, the translated shell labels, and `tools/validate_data.py` failure paths. |
| `test/unit/test_app_identity.gd` | The app name, package id, version record, Android SDK targets and permissions, landscape orientation, and the safe-area margins. |
| `test/unit/test_isolation.gd` | The isolation and offline guard scripts, including their failure paths. |
| `test/unit/test_save_system.gd` | Atomic save writes, the `.bak` last-good backup, corrupt-file recovery, and the schema migration fixtures. |
| `test/unit/test_determinism.gd` | Seedable `Rng` sequences, `Timestep.FIXED_DELTA`, and the scan that fails on direct `randi`, `randf`, or `randomize` calls in `scripts/` outside `scripts/core/rng.gd`. |
| `test/unit/test_data_validator.gd` | The data validator entry point and its modules, including the exact file and field reported for malformed JSON, a missing required field, an inverted SDK range, and an extra permission. |

The guard scripts can also be run directly:

```sh
python3 tools/validate_data.py
python3 tools/check_isolation.py
python3 tools/check_offline.py
```

## Data validation

```sh
python3 tools/validate_data.py
```

`validate_data.py` is the single entry point for every data file the game
loads. It discovers each module under `tools/validate/`, calls that module's
`validate(root) -> list[str]`, and prints every problem before exiting
non-zero. A failure is always one line of the form
`<file>:<line>: <message> (field '<name>')`, so the file and field to fix are
explicit — for example,
`data/i18n/strings.csv:<line>: missing translation for key '<key>' (field 'de')`.

| Validator module | Data file | Checks |
| --- | --- | --- |
| `tools/validate/i18n.py` | `data/i18n/strings.csv` | Header shape, dotted keys, duplicates, English/German coverage, and every `tr_key()` reference in `scripts/` and `scenes/`. |
| `tools/validate/android_targets.py` | `data/android_targets.json` | JSON syntax, the required `source`, `minSdk`, `targetSdk`, and `permissions` fields, integer types, `minSdk <= targetSdk`, and the billing-only permission list. |

**Every new data type adds a validator module.** Create one file under
`tools/validate/` that exposes `validate(root: Path) -> list[str]` and returns
one `<file>:<line>: <message> (field '<name>')` string per problem.
`validate_data.py` picks the module up automatically, so it needs no edit.
Modules whose name starts with an underscore are shared helpers and are not
discovered.

## Determinism

Randomness and timing are injected so a run can be replayed from its inputs.

- `scripts/core/rng.gd` wraps `RandomNumberGenerator` behind the `Rng` class.
  Construct it with a seed (`Rng.new(12345)`), reseed it with `set_seed()`, and
  draw values with `randf()`, `randf_range()`, `randi()`, and `randi_range()`.
  Two instances built with the same seed emit the same sequence, and the
  default seed is fixed.
- `scripts/core/timestep.gd` defines `Timestep.FIXED_DELTA = 1.0 / 60.0`, the
  only step size simulation code should advance by.
- `test/unit/test_determinism.gd` walks every `.gd` file under `scripts/` and
  fails with each offending `file:line` when a script calls `randi`, `randf`,
  or `randomize` directly. `scripts/core/rng.gd` is the single exception, so
  gameplay code takes an `Rng` instead of reaching for the global functions.

## Formatting and linting

```sh
gdlint scripts test
gdformat --check scripts test
```

Both read `.gdlintrc` from the project directory. Untyped declarations are
rejected by the engine itself, so a script that lints but is untyped still
fails to load.
