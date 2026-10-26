---
title: Blender and MCP Setup
description: Install Blender and the MCP for Blender server and addon, connect them to VS Code, and verify the connection for harness asset generation
ms.date: 2026-10-26
---

## Overview

Blender is optional. The harness uses it to source or generate assets such as 3D models, textures, HDRIs, and preview renders before it asks a human for them. Without Blender, asset needs become human tasks.

The connection chain has four parts:

* Blender 3.0 or newer
* `uv`, the Python package manager that runs the MCP server through `uvx`
* The MCP for Blender server, published on PyPI as `mcp-for-blender` (formerly `blender-mcp`). It is a third-party, MIT-licensed project that is not made by the Blender Foundation.
* The "MCP for Blender" addon, which runs a socket server inside Blender (default `localhost:9876`)

```text
VS Code agent -> MCP server (stdio) -> addon socket server (localhost:9876) -> Blender
```

Installing software changes the machine. The setup agent asks for explicit confirmation before it runs any command in this document or edits any MCP configuration.

Rules for using Blender safely are in the Blender Access section of the [security model](security-model.md).

## Check What Is Installed

These checks only read state.

```bash
blender --version
uv --version
ls "$HOME/Library/Application Support/Blender"/*/scripts/addons/blender_mcp.py
```

* If `blender` is not on the PATH, run `/Applications/Blender.app/Contents/MacOS/Blender --version` on macOS.
* Addon folders: macOS `~/Library/Application Support/Blender/<version>/scripts/addons/`, Linux `~/.config/blender/<version>/scripts/addons/`, Windows `%APPDATA%\Blender Foundation\Blender\<version>\scripts\addons\`.
* In VS Code, run the command `MCP: List Servers` and look for a `blender` entry.
* If the entry exists and Blender is running with the server started, a call to the `get_addon_status` tool returns the Blender version, the addon version, and the enabled libraries. A successful call proves the whole chain works.

## Install on macOS

Run each step only if the check above shows the component is missing.

1. Install Blender:

    ```bash
    brew install --cask blender
    ```

2. Install `uv`:

    ```bash
    brew install uv
    ```

3. Install the addon:

    ```bash
    uvx mcp-for-blender install-addon
    ```

    The command prints where it wrote `blender_mcp.py` and keeps a `.bak` of any file it replaces. The vendor also offers `uvx mcp-for-blender setup`, which finds MCP clients including VS Code, edits their configuration (keeping a `.bak`), and installs and enables the addon. Use it if you want the automatic route and accept the configuration edits.

4. Add the server to the VS Code MCP configuration. Prefer the user-level file (`MCP: Open User Configuration`) so the machine-specific `uvx` path stays out of the repository. Use the output of `which uvx` as `command`, because VS Code started from the Dock does not inherit your shell PATH.

    ```json
    {
      "servers": {
        "blender": {
          "type": "stdio",
          "command": "/absolute/path/to/uvx",
          "args": ["--python", "3.11", "mcp-for-blender"],
          "env": {
            "UV_PYTHON_PREFERENCE": "only-managed",
            "BLENDER_MCP_SAFE_MODE": "1",
            "DISABLE_TELEMETRY": "true"
          }
        }
      }
    }
    ```

    * `--python 3.11` with `UV_PYTHON_PREFERENCE=only-managed` keeps `uv` away from conda, pyenv, or system Python.
    * `BLENDER_MCP_SAFE_MODE=1` blocks risky scripts. It is a blocklist and not a security boundary.
    * `DISABLE_TELEMETRY=true` turns off the anonymous usage record.
    * For unattended runs, pin a reviewed version, for example `mcp-for-blender==<version>`.

5. Enable the addon in Blender. Open Edit > Preferences > Add-ons and enable "Interface: MCP for Blender". If it does not appear, restart Blender, or use Install... and select the copied `blender_mcp.py`.
6. Start the server in Blender. In the 3D Viewport press `N`, open the "MCP for Blender" tab, tick the libraries you want, and click Start MCP Server (labelled Connect to Claude in some versions).
7. Start or restart the `blender` server in VS Code with `MCP: List Servers`.
8. Ask the agent to call `get_addon_status`. A reply listing the Blender and addon versions confirms the connection.

## Install on Linux or Windows

* Install Blender from <https://www.blender.org/download/> or your package manager. On Windows, `winget install --id=astral-sh.uv -e` installs `uv`.
* Follow the same steps 3 to 8 above. On Windows, set `command` to `cmd` with `args` of `["/c", "uvx", "--python", "3.11", "mcp-for-blender"]`, or use the full path to `uvx.exe`.
* Vendor documentation: <https://pypi.org/project/mcp-for-blender/>.

## Libraries and Credentials

Each source is switched on in the sidebar tab.

* Poly Haven: CC0 textures, HDRIs, and models. No key needed. This is the default source for the harness.
* Poly Pizza: free low-poly models. Needs a free API key. Many models are CC-BY and require attribution.
* Sketchfab: needs an API key. Licenses vary by model.
* AI model generators (Meshy, Tripo, Hyper3D Rodin, Hunyuan3D): need a provider key with a paid plan, or vendor Premium credits. Generation can spend credits.

Store keys in Edit > Preferences > Add-ons > MCP for Blender, or in `BLENDERMCP_*` environment variables. Never paste keys into chat, issues, or repository files.

The harness defaults allow CC0 sources only and no paid generation. Enable other sources only when the approved execution policy allows them.

## Troubleshooting

* `spawn uvx ENOENT`: set `command` to the absolute path from `which uvx`, then fully quit and reopen VS Code.
* Install fails with Python or wheel errors: keep the `--python 3.11` pin, then run `uv cache clean mcp-for-blender blender-mcp && uvx --refresh mcp-for-blender`.
* No Blender tools appear: confirm the addon server is started in Blender, then restart the `blender` server in VS Code. Connect only one MCP client at a time.
* Timeouts: break the request into smaller steps.
* Blender freezes during a Poly Haven download: downloads run on Blender's main thread. Request 1k or 2k resolution unless the asset sits close to the camera.
* Port conflict: change the port in the addon panel and set `BLENDER_PORT` or pass `--port` to match.
* Upgrade: run `uvx mcp-for-blender@latest update`, restart Blender, and restart the VS Code server entry.

## Remove

Delete the `blender` entry from the MCP configuration, disable the addon in Blender, and delete `blender_mcp.py` from the addons folder. Run `brew uninstall --cask blender` and `brew uninstall uv` only if nothing else uses them.
