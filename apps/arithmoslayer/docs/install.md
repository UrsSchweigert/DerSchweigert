# Installing the Arithmo Slayer toolchain

Arithmo Slayer targets **Godot 4.7.2 stable** (`4.7.2.stable.official`).
`engine-version.txt` records the pin and `test/unit/test_project_config.gd`
fails when it drifts.

## 1. Install Godot 4.7.2

1. Download the Godot 4.7.2 stable editor for your platform from
   <https://godotengine.org/download/archive/>.
2. Unpack it and put the `godot` binary on `PATH`.
3. Verify the exact version:

   ```sh
   godot --version
   # 4.7.2.stable.official.<build>
   ```

The standard (non-.NET) build is required; the project does not use C#.

## 2. Install the Python tooling

The guard scripts and the GDScript linters run on Python 3.11 or newer.

```sh
python3 -m pip install gdtoolkit==4.5.0
```

Verify:

```sh
gdlint --version
gdformat --version
```

## 3. Get the test framework

The project does not vendor GUT. The harness provides `godot-test`, which copies
GUT 9.6 next to a throwaway copy of the project. For a local editor run, install
GUT 9.6 into `apps/arithmoslayer/addons/gut/` yourself; `addons/` is ignored by
the linters and is not committed.

## 4. Verify the project

Run these from `apps/arithmoslayer/`:

```sh
godot-test .
gdlint scripts test
gdformat --check scripts test
python3 tools/validate_data.py
python3 tools/check_isolation.py
python3 tools/check_offline.py
```

A headless import proves the project loads without the editor:

```sh
godot --headless --path . --import
```

The trusted harness smoke check goes one step further: it copies the project to
a temporary directory, imports it headless, and loads every script, scene, and
resource. A parse error or a broken scene therefore fails before merge.

## Troubleshooting

- **`Parse Error: ... has no static type`** — untyped declarations are errors in
  this project. Add the type to the variable, parameter, or return value.
- **`godot-test` cannot find GUT** — run it through the harness, or install GUT
  9.6 into `addons/gut/` for local use.
- **`check_isolation` reports an outside path** — move the file into
  `apps/arithmoslayer/`; changes elsewhere are out of scope for this app.
