#!/usr/bin/env python3
"""Render a scene's layers from its art packet with fal.ai.

Reads ``sources/<scene>/layers.json`` (one entry per layer: prompt, seed, size,
whether it is a cutout) and writes the raw renders into ``sources/<scene>/``.
Cutouts are then processed with tools/cutout.py and everything is encoded with
tools/encode.py, so this only does the rendering step.

    python3 tools/generate.py act-1            # one scene
    python3 tools/generate.py act-1 --only=backdrop
    python3 tools/generate.py --missing        # every scene with renders missing

Only generators approved in ART-BIBLE.md may be used: flux-1/schnell
(Apache-2.0) or a flux-pro endpoint. FLUX.1 [dev] is excluded for licensing
reasons.

The fal helper lives at the repository root (tools/fal_image.py) and needs an
interpreter with fal-client installed; both are configurable:

    FAL_IMAGE_TOOL=/path/to/tools/fal_image.py
    FAL_PYTHON=/path/to/python
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

STORY = Path(__file__).resolve().parent.parent
ROOT = STORY.parent.parent.parent
DEFAULT_TOOL = ROOT / "tools" / "fal_image.py"
DEFAULT_PYTHON = ROOT / ".venv" / "bin" / "python"


def render(scene: str, layer: dict, scene_dir: Path, tool: str, python: str) -> Path:
    destination = scene_dir / f"{layer['id']}-raw.png"
    size = layer.get("size") or {}
    command = [
        python, tool, layer["prompt"],
        "--model", layer.get("model", "fal-ai/flux-1/schnell"),
        "--param", f"image_size={json.dumps(size)}",
        # PNG keeps cutout edges clean for tools/cutout.py; WebP is written later.
        "--param", "output_format=png",
        "--out", str(scene_dir),
    ]
    if layer.get("seed") is not None:
        command += ["--seed", str(layer["seed"])]
    print("  rendering", layer["id"], f"({size.get('width')}x{size.get('height')})")
    result = subprocess.run(command, capture_output=True, text=True)
    if result.returncode != 0:
        raise SystemExit(f"{scene}/{layer['id']}: {result.stderr.strip()[-400:]}")
    produced = [line.strip() for line in result.stdout.splitlines() if line.strip().endswith((".jpg", ".png"))]
    if not produced:
        raise SystemExit(f"{scene}/{layer['id']}: no image in output:\n{result.stdout[-400:]}")
    Path(produced[0]).replace(destination)
    return destination


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("scenes", nargs="*", help="scene ids (default: every scene in sources/)")
    parser.add_argument("--only", help="render a single layer id")
    parser.add_argument("--missing", action="store_true", help="skip layers whose raw render exists")
    args = parser.parse_args(argv)

    tool = os.environ.get("FAL_IMAGE_TOOL", str(DEFAULT_TOOL))
    python = os.environ.get("FAL_PYTHON", str(DEFAULT_PYTHON))
    if not Path(tool).is_file():
        raise SystemExit(f"fal helper not found at {tool}; set FAL_IMAGE_TOOL")
    if not Path(python).is_file():
        raise SystemExit(f"python with fal-client not found at {python}; set FAL_PYTHON")

    scenes = args.scenes or sorted(
        path.name for path in (STORY / "sources").iterdir()
        if (path / "layers.json").is_file())
    for scene in scenes:
        scene_dir = STORY / "sources" / scene
        packet = json.loads((scene_dir / "layers.json").read_text())
        print(f"{scene}: {len(packet['layers'])} layers")
        for layer in packet["layers"]:
            if args.only and layer["id"] != args.only:
                continue
            if args.missing and (scene_dir / f"{layer['id']}-raw.png").exists():
                print("  skip", layer["id"], "(raw exists)")
                continue
            render(scene, layer, scene_dir, tool, python)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
