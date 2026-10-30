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
| `test/unit/test_isolation.gd` | The isolation and offline guard scripts, including their failure paths. |

The guard scripts can also be run directly:

```sh
python3 tools/check_isolation.py
python3 tools/check_offline.py
```

## Formatting and linting

```sh
gdlint scripts test
gdformat --check scripts test
```

Both read `.gdlintrc` from the project directory. Untyped declarations are
rejected by the engine itself, so a script that lints but is untyped still
fails to load.
