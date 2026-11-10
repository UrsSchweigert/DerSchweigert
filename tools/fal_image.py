#!/usr/bin/env python3
"""Generate images with FAL models from the command line.

Dependency: pip install fal-client

The API key is resolved in this order:
  1. --key-file PATH
  2. FAL_KEY environment variable
  3. macOS Keychain (security find-generic-password -s FAL_KEY -w)
  4. ~/.config/fal/key
  5. FAL_KEY= in the repository .env file

Examples:
  python tools/fal_image.py "a lighthouse at dusk, oil painting"
  python tools/fal_image.py "logo concept" -m fal-ai/flux-1/dev --size 1024x1024 -n 2
  python tools/fal_image.py "test" --dry-run

`generate()` is the reusable entry point; tools/fal_mcp/server.py wraps it as an MCP tool.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

DEFAULT_MODEL = "fal-ai/flux-1/schnell"
DEFAULT_OUTPUT_DIR = Path("uploads/fal")
REPO_ROOT = Path(__file__).resolve().parent.parent
ENV_VAR = "FAL_KEY"


class MissingKeyError(RuntimeError):
    pass


class FalRequestError(RuntimeError):
    pass


def _read_env_file(env_path: Path) -> str | None:
    if not env_path.is_file():
        return None
    for raw in env_path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        name, _, value = line.partition("=")
        if name.strip() == ENV_VAR:
            return value.strip().strip("\"'")
    return None


def _read_key_file(path: Path) -> str | None:
    """Read a key file that holds either a bare key or a FAL_KEY=... line."""
    if not path.is_file():
        return None
    content = path.read_text(encoding="utf-8").strip()
    if not content:
        return None
    if ENV_VAR in content and "=" in content:
        return _read_env_file(path)
    return content.strip().strip("\"'")


def _read_keychain() -> str | None:
    if sys.platform != "darwin":
        return None
    try:
        out = subprocess.run(
            ["security", "find-generic-password", "-s", ENV_VAR, "-w"],
            capture_output=True,
            text=True,
            check=True,
        )
    except (subprocess.CalledProcessError, FileNotFoundError):
        return None
    return out.stdout.strip() or None


def resolve_key(key_file: str | None = None) -> str:
    if key_file:
        value = Path(key_file).expanduser().read_text(encoding="utf-8").strip()
        if not value:
            raise MissingKeyError(f"{key_file} is empty")
        return value

    for candidate in (
        os.environ.get(ENV_VAR),
        _read_keychain(),
        _read_key_file(Path("~/.config/fal/key").expanduser()),
        _read_env_file(REPO_ROOT / ".env"),
    ):
        if candidate:
            return candidate

    raise MissingKeyError(
        "No FAL_KEY found. Set the environment variable, store the key in "
        "~/.config/fal/key, add FAL_KEY=... to .env, or pass --key-file."
    )


def parse_size(value: str) -> dict | str:
    if "x" in value.lower():
        width, _, height = value.lower().partition("x")
        return {"width": int(width), "height": int(height)}
    return value


def parse_param(value: str) -> tuple[str, object]:
    if "=" not in value:
        raise argparse.ArgumentTypeError(f"expected key=value, got {value!r}")
    key, _, raw = value.partition("=")
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        parsed = raw
    return key.strip(), parsed


def build_arguments(
    prompt: str,
    size: str | None = None,
    num_images: int | None = None,
    seed: int | None = None,
    steps: int | None = None,
    output_format: str | None = None,
    extra: dict | None = None,
) -> dict:
    arguments: dict = {"prompt": prompt}
    if size:
        arguments["image_size"] = parse_size(size)
    if num_images:
        arguments["num_images"] = num_images
    if seed is not None:
        arguments["seed"] = seed
    if steps is not None:
        arguments["num_inference_steps"] = steps
    if output_format:
        arguments["output_format"] = output_format
    for key, value in (extra or {}).items():
        arguments[key] = value
    return arguments


def download(url: str, destination_dir: Path, index: int, seed: object) -> Path:
    destination_dir.mkdir(parents=True, exist_ok=True)
    suffix = Path(url.split("?")[0]).suffix or ".jpg"
    target = destination_dir / f"fal_{time.strftime('%Y%m%d-%H%M%S')}_{seed}_{index}{suffix}"
    with urllib.request.urlopen(url) as response, open(target, "wb") as handle:
        handle.write(response.read())
    return target


def generate(
    arguments: dict,
    model: str = DEFAULT_MODEL,
    out_dir: str | Path = DEFAULT_OUTPUT_DIR,
    key_file: str | None = None,
) -> dict:
    """Run one fal endpoint call, download the images, and describe the result."""
    os.environ[ENV_VAR] = resolve_key(key_file)

    try:
        import fal_client
    except ImportError as exc:
        raise FalRequestError(
            "fal-client is not installed in this interpreter; run "
            "`pip install fal-client` (or use the MCP server, which resolves it via uv)."
        ) from exc

    try:
        result = fal_client.run(model, arguments=arguments)
    except Exception as exc:  # network, auth, validation, quota
        raise FalRequestError(str(exc)) from exc

    images = result.get("images") or []
    if not images:
        raise FalRequestError(f"no images in response: {json.dumps(result)[:500]}")

    returned_seed = result.get("seed", "unknown")
    destination = Path(out_dir).expanduser()
    written = []
    for index, image in enumerate(images, start=1):
        url = image.get("url")
        if not url:
            continue
        written.append({"path": str(download(url, destination, index, returned_seed)), "url": url})

    if not written:
        raise FalRequestError("response contained no downloadable image urls")

    return {
        "model": model,
        "prompt": arguments.get("prompt"),
        "seed": returned_seed,
        "images": written,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Generate images with FAL models.")
    parser.add_argument("prompt", help="text prompt describing the image")
    parser.add_argument("-m", "--model", default=DEFAULT_MODEL, help=f"FAL endpoint id (default: {DEFAULT_MODEL})")
    parser.add_argument("-n", "--num-images", type=int, default=1, help="number of images (default: 1)")
    parser.add_argument("-s", "--size", help="image size, e.g. 1024x1024 or landscape_4_3")
    parser.add_argument("-o", "--out", default=str(DEFAULT_OUTPUT_DIR), help=f"output directory (default: {DEFAULT_OUTPUT_DIR})")
    parser.add_argument("--seed", type=int, help="reproducibility seed")
    parser.add_argument("--steps", type=int, help="inference steps")
    parser.add_argument("--format", dest="output_format", choices=["jpeg", "png"], help="output file format")
    parser.add_argument("--param", type=parse_param, action="append", default=[], metavar="KEY=VALUE",
                        help="extra endpoint parameter; values parse as JSON when possible")
    parser.add_argument("--key-file", help="file containing the API key")
    parser.add_argument("--dry-run", action="store_true", help="print the request without calling the API")
    args = parser.parse_args(argv)

    arguments = build_arguments(
        args.prompt,
        size=args.size,
        num_images=args.num_images,
        seed=args.seed,
        steps=args.steps,
        output_format=args.output_format,
        extra=dict(args.param),
    )

    if args.dry_run:
        print(f"endpoint: {args.model}")
        print(json.dumps(arguments, indent=2))
        try:
            resolve_key(args.key_file)
            print("key: found")
        except MissingKeyError as exc:
            print(f"key: missing ({exc})")
        return 0

    try:
        result = generate(arguments, model=args.model, out_dir=args.out, key_file=args.key_file)
    except MissingKeyError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    except FalRequestError as exc:
        print(f"error: fal request failed: {exc}", file=sys.stderr)
        return 1

    for image in result["images"]:
        print(image["path"])
    print(f"done: {len(result['images'])} image(s) from {result['model']} (seed {result['seed']})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
