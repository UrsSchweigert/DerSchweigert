---
name: fal-image-generation
description: "Generate images with FAL (fal.ai) models such as FLUX.1 schnell/dev/pro. Prefer the `generate_image` MCP tool; the equivalent CLI is tools/fal_image.py."
argument-hint: "<image prompt> [model=fal-ai/flux-1/schnell] [size=landscape_4_3]"
---
# FAL Image Generation

`tools/fal_image.py` calls the fal.ai HTTP API through the official `fal-client` SDK and writes
the resulting files to disk. Do not call the fal REST endpoints by hand — use this helper so key
resolution, queue polling, and downloading stay in one place.

## Two entry points

* **MCP tools** (`generate_image`, `fal_status`) registered in `.vscode/mcp.json`, served by
  `tools/fal_mcp_server.py`. Prefer these in chat: they return structured output and can embed the
  image inline. Start the server with **MCP: List Servers → fal → Start** if it is not running.
* **CLI** `tools/fal_image.py`, for terminal work and scripting. Both share the same code in
  `tools/fal_image.py`, so parameters and key resolution behave identically.

## Command

```bash
pip install fal-client          # one-time, into the interpreter you run this with
.venv/bin/python tools/fal_image.py "<prompt>" [options]
```

| Option | Meaning |
|---|---|
| `-m, --model` | FAL endpoint id (default `fal-ai/flux-1/schnell`) |
| `-n, --num-images` | 1–4 images |
| `-s, --size` | `landscape_4_3` \| `landscape_16_9` \| `square_hd` \| `portrait_4_3` \| `1024x1024` |
| `-o, --out` | Output directory (default `uploads/fal`, gitignored) |
| `--seed` | Reproducibility seed |
| `--steps` | Inference steps |
| `--format` | `jpeg` \| `png` |
| `--param KEY=VALUE` | Any extra endpoint parameter; value parses as JSON when possible |
| `--key-file` | Explicit key file |
| `--dry-run` | Print the JSON request and key status without spending money |

The script prints one absolute path per generated image, then a summary with the seed.
Always report the returned seed — it is the only way to regenerate the same image.

## Choosing a model

| Endpoint | Speed / cost | Use for |
|---|---|---|
| `fal-ai/flux-1/schnell` | 4 steps, $0.003/MP | fast drafts, iteration |
| `fal-ai/flux-1/dev` | higher quality | final quality, 12B params |
| `fal-ai/flux-1/pro` | slowest, priciest | best text rendering / prompt adherence |

Non-FLUX endpoints work too (image-to-image, upscalers, background removal): pass their endpoint
id and their parameters via `--param`. Check `https://fal.ai/models/<endpoint-id>/llms.txt` for
that endpoint's schema before guessing parameter names.

## API key

Resolution order, first hit wins:

1. `--key-file PATH`
2. `FAL_KEY` environment variable
3. macOS Keychain (`security find-generic-password -s FAL_KEY -w`)
4. `~/.config/fal/key` (bare key or `FAL_KEY=...`)
5. `FAL_KEY=` in the repository `.env`

Never print, log, or commit the key. Never echo it into a shell command that lands in a transcript.

## Troubleshooting

* `403 User is locked. Reason: TOP_UP.` — account out of credit. Auth is fine; the user must top up
  at <https://fal.ai/dashboard/billing>. Do not retry or switch models, report it and stop.
* `No FAL_KEY found` — key is not stored in any of the five locations above.
* `no images in response` — usually an invalid `--param`; rerun with `--dry-run` to inspect.
