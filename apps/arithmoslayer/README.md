# Arithmo Slayer

Arithmo Slayer is an offline-first, data-driven math game built with Godot
4.7.2. This directory is the whole game: it is isolated from the browser game
that lives in the sibling site tree and never reaches the network.

## Quick start

```sh
cd apps/arithmoslayer
godot-test .
gdlint scripts test
gdformat --check scripts test
python3 tools/check_isolation.py
python3 tools/check_offline.py
```

## Documentation

- [`docs/install.md`](docs/install.md) — install Godot 4.7.2, gdtoolkit, and GUT.
- [`docs/architecture.md`](docs/architecture.md) — directory layout and autoloads.
- [`docs/testing.md`](docs/testing.md) — test, lint, and format workflow.

## Layout at a glance

```
apps/arithmoslayer/
  project.godot        # engine settings, autoloads, warning policy
  engine-version.txt   # pinned Godot version
  scenes/              # packed scenes, main.tscn is the entry point
  scripts/             # typed GDScript, autoloads under scripts/autoload/
  data/                # data-driven content (i18n, project data)
  shaders/             # Godot shaders (added with the first shader)
  assets/              # art, audio, fonts (added with the first asset)
  test/                # GUT tests
  docs/                # architecture, install, testing
  tools/               # isolation and offline guard scripts
```

The skeleton contains no gameplay systems, art, or audio yet.
