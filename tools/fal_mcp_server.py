# /// script
# requires-python = ">=3.10"
# dependencies = ["mcp", "fal-client"]
# ///
"""MCP server exposing FAL image generation to VS Code / Copilot Chat.

Run directly (uv resolves the dependencies from the block above):

    uv run tools/fal_mcp_server.py

Wrapped by the shared logic in tools/fal_image.py, so key resolution and
parameters behave exactly like the CLI.
"""

from __future__ import annotations

import sys
from pathlib import Path

TOOLS_DIR = Path(__file__).resolve().parent
REPO_ROOT = TOOLS_DIR.parent
sys.path.insert(0, str(TOOLS_DIR))

import fal_image
from mcp.server.mcpserver import Image, MCPServer

OUTPUT_DIR = REPO_ROOT / "uploads" / "fal"

server = MCPServer(
    name="fal",
    instructions=(
        "Generate images with fal.ai models. Default endpoint is fal-ai/flux-1/schnell "
        "(fastest, $0.003/MP); use fal-ai/flux-1/dev or fal-ai/flux-1/pro for higher quality. "
        "Always report the returned seed so an image can be reproduced."
    ),
)


def _failure(exc: Exception) -> str:
    message = str(exc)
    if "TOP_UP" in message:
        return (
            "ERROR: the fal.ai account is locked pending billing (TOP_UP). The API key is valid; "
            "add credit at https://fal.ai/dashboard/billing and retry."
        )
    if isinstance(exc, fal_image.MissingKeyError):
        return (
            f"ERROR: {message} Store the key in ~/.config/fal/key or set the FAL_KEY "
            "environment variable for the MCP server process."
        )
    return f"ERROR: fal request failed: {message}"


@server.tool(
    description=(
        "Generate one or more images from a text prompt with a fal.ai model and save them to "
        "uploads/fal. Returns the file paths and the seed used."
    )
)
def generate_image(
    prompt: str,
    model: str = fal_image.DEFAULT_MODEL,
    size: str | None = None,
    num_images: int = 1,
    seed: int | None = None,
    steps: int | None = None,
    output_format: str | None = None,
    attach_images: bool = True,
) -> list:
    """Args:
        prompt: what the image should show.
        model: fal endpoint id, e.g. fal-ai/flux-1/schnell.
        size: "landscape_4_3", "landscape_16_9", "square_hd", "portrait_4_3", or "1024x1024".
        num_images: how many images to generate (1-4).
        seed: reproducibility seed; reuse the value from a previous result.
        steps: inference steps, endpoint dependent.
        output_format: "jpeg" or "png".
        attach_images: return the images inline so the chat can display them.
    """
    try:
        arguments = fal_image.build_arguments(
            prompt,
            size=size,
            num_images=num_images,
            seed=seed,
            steps=steps,
            output_format=output_format,
        )
        result = fal_image.generate(arguments, model=model, out_dir=OUTPUT_DIR)
    except Exception as exc:
        return [_failure(exc)]

    paths = [item["path"] for item in result["images"]]
    summary = (
        f"Generated {len(paths)} image(s) with {result['model']} (seed {result['seed']}).\n"
        + "\n".join(paths)
    )

    if not attach_images:
        return [summary]

    content: list = [summary]
    for path in paths:
        try:
            content.append(Image(data=Path(path).read_bytes(), format=Path(path).suffix.lstrip(".") or "jpeg"))
        except Exception:  # an unreadable file should not fail the whole call
            continue
    return content


@server.tool(
    description=(
        "Report whether a FAL API key is resolvable and which default model is configured. "
        "Makes no paid API call."
    )
)
def fal_status() -> str:
    try:
        fal_image.resolve_key()
    except fal_image.MissingKeyError as exc:
        return f"Key: missing ({exc})"
    return f"Key: found. Default model: {fal_image.DEFAULT_MODEL}. Output: {OUTPUT_DIR}"


if __name__ == "__main__":
    server.run()
