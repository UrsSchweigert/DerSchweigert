"""Asset generation: policy, request validation, source order, provenance manifest, deterministic validation,
a brokered headless Blender runner, and the human-task fallback that works without Blender."""
from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import socket
import struct
import subprocess
import tempfile
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence

from . import humantasks, schemas, telemetry
from .broker import assert_no_secrets, BrokerRejected
from .isolation import scrub_env
from .store import Store

ASSET_REQUEST = {
    "request_id": str, "issue_id": str, "purpose": str, "asset_class": str, "format": str, "output_path": str,
    "source": ("repository", "cc0_library", "procedural", "ai"),
    "limits?": dict, "style_notes?": str, "existing_path?": str, "script?": str, "library?": dict, "generator?": str, "prompt?": str,
}
SOURCE_ORDER = ("repository", "cc0_library", "procedural", "ai")
AMBIGUOUS_LICENSE = re.compile(r"(unknown|various|unspecified|\?|tbd|mixed|custom)", re.I)
ABS_PATH = re.compile(r"(/Users/|/home/|/private/var/|[A-Za-z]:\\\\|file://)")
EMBEDDED_CODE = re.compile(rb"(<script|__import__|import os|import subprocess|eval\(|exec\()")
SECRET_BYTES = re.compile(rb"(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----)")
SCRIPT_BLOCKLIST = re.compile(r"\b(import\s+(os|sys|subprocess|socket|shutil|ctypes|importlib|urllib|requests|pathlib|http)|from\s+(os|sys|subprocess|socket|shutil|ctypes|importlib|urllib|pathlib)\b|"
                              r"__import__|eval\s*\(|exec\s*\(|open\s*\(|compile\s*\(|getattr\s*\(|bpy\.ops\.wm\.|bpy\.app\.|os\.)")


class AssetError(Exception):
    pass


def asset_path(root: str, relative: str) -> str:
    """Resolve a repository asset path without following untrusted symlinks."""
    if not isinstance(relative, str) or not relative or "\\" in relative or "\0" in relative:
        raise AssetError("invalid asset path")
    path = Path(relative)
    if path.is_absolute() or ".." in path.parts or not path.parts:
        raise AssetError("asset path must stay inside the repository")
    base = Path(root).resolve()
    candidate = base
    for part in path.parts:
        candidate = candidate / part
        if candidate.is_symlink():
            raise AssetError("asset path contains a symlink: %s" % relative)
    try:
        candidate.resolve().relative_to(base)
    except (ValueError, RuntimeError) as exc:
        raise AssetError("asset path must stay inside the repository") from exc
    return str(candidate)


def sha256_file(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


# -- request validation ----------------------------------------------------------------

def validate_request(policy: Dict[str, Any], req: Dict[str, Any], root: Optional[str] = None) -> List[str]:
    """Reject requests that the policy does not allow before any source is tried."""
    a = policy["assets"]
    try:
        schemas.validate(req, ASSET_REQUEST, "asset_request")
        assert_no_secrets(req, "asset_request")
    except (schemas.SchemaError, BrokerRejected) as exc:
        return [str(exc)]
    problems: List[str] = []
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}", req["request_id"]):
        problems.append("request_id must be a bounded identifier, not a path")
    cls = a["classes"].get(req["asset_class"])
    if cls is None:
        return ["asset class %r is not defined by the policy" % req["asset_class"]]
    if req["format"] not in cls["formats"]:
        problems.append("format %r is not allowed for %s (allowed: %s)" % (req["format"], req["asset_class"], cls["formats"]))
    out = os.path.normpath(req["output_path"])
    base = os.path.normpath(a["output_dir"])
    if os.path.isabs(out) or out.startswith("..") or not (out + os.sep).startswith(base + os.sep):
        problems.append("output path must be inside %s" % a["output_dir"])
    elif not re.match(a["name_pattern"], os.path.basename(out)) or not out.endswith("." + req["format"]):
        problems.append("file name violates the naming convention")
    if req["source"] not in a["allowed_sources"] and req["source"] != "ai":
        problems.append("source %r is not allowed by the policy" % req["source"])
    if req["source"] == "ai" and a["paid_generation_credits"] <= 0:
        problems.append("AI generation needs a nonzero paid-generation budget named in the policy")
    for key, value in (req.get("limits") or {}).items():
        if key in cls and isinstance(value, (int, float)) and isinstance(cls[key], (int, float)) and value > cls[key]:
            problems.append("limit %s=%s exceeds the policy maximum %s" % (key, value, cls[key]))
    lib = req.get("library") or {}
    if lib.get("license") and lib["license"] not in a["allowed_licenses"]:
        problems.append("license %r is not allowed (allowed: %s)" % (lib["license"], a["allowed_licenses"]))
    if root is not None and not problems:
        relatives = [req["output_path"], str(Path(a["output_dir"]) / "manifest.json"),
                     str(Path(a["output_dir"]) / "manifest.json.tmp"),
                     str(Path(a["output_dir"]) / "scripts" / (req["request_id"] + ".py"))]
        for relative in relatives:
            try:
                asset_path(root, relative)
            except AssetError as exc:
                problems.append(str(exc))
    return problems


# -- format inspection -----------------------------------------------------------------

def image_dims(data: bytes) -> Optional[Sequence[int]]:
    if data[:8] == b"\x89PNG\r\n\x1a\n" and len(data) >= 24:
        return struct.unpack(">II", data[16:24])
    if data[:2] == b"\xff\xd8":
        i = 2
        while i + 9 < len(data):
            if data[i] != 0xFF:
                i += 1
                continue
            marker = data[i + 1]
            if marker in (0xC0, 0xC1, 0xC2):
                h, w = struct.unpack(">HH", data[i + 5:i + 9])
                return (w, h)
            i += 2 + struct.unpack(">H", data[i + 2:i + 4])[0]
    return None


def read_gltf(path: str) -> Dict[str, Any]:
    """Return the glTF JSON and the embedded BIN chunk for .glb, or the JSON for .gltf."""
    with open(path, "rb") as fh:
        data = fh.read()
    if path.endswith(".glb"):
        if data[:4] != b"glTF" or len(data) < 20:
            raise AssetError("not a valid GLB file")
        length = struct.unpack("<I", data[12:16])[0]
        doc = json.loads(data[20:20 + length].decode("utf-8"))
        rest = data[20 + length:]
        bin_chunk = rest[8:8 + struct.unpack("<I", rest[:4])[0]] if len(rest) >= 8 else b""
        return {"json": doc, "bin": bin_chunk}
    return {"json": json.loads(data.decode("utf-8")), "bin": b""}


def gltf_stats(path: str) -> Dict[str, Any]:
    g = read_gltf(path)
    doc, accessors = g["json"], g["json"].get("accessors", [])
    triangles, extent, uris, images = 0, None, [], []
    for mesh in doc.get("meshes", []):
        for prim in mesh.get("primitives", []):
            mode = prim.get("mode", 4)
            idx = prim.get("indices")
            count = accessors[idx]["count"] if idx is not None else accessors[prim["attributes"]["POSITION"]]["count"]
            triangles += count // 3 if mode == 4 else max(count - 2, 0) if mode in (5, 6) else 0
            pos = accessors[prim["attributes"]["POSITION"]]
            if "min" in pos and "max" in pos:
                ext = max(b - a for a, b in zip(pos["min"], pos["max"]))
                extent = ext if extent is None else max(extent, ext)
            else:
                extent = float("inf")
    for buf in doc.get("buffers", []):
        if "uri" in buf:
            uris.append(buf["uri"])
    for img in doc.get("images", []):
        if "uri" in img:
            uris.append(img["uri"])
        elif "bufferView" in img and g["bin"]:
            view = doc["bufferViews"][img["bufferView"]]
            images.append(image_dims(g["bin"][view.get("byteOffset", 0):view.get("byteOffset", 0) + view["byteLength"]]))
    return {"triangles": triangles, "extent": extent, "uris": uris, "image_dims": images}


# -- deterministic validation ---------------------------------------------------------------

def validate_entry(root: str, entry: Dict[str, Any], policy: Dict[str, Any], asset_class: str) -> List[str]:
    """All checks are code, never an agent's opinion. Anything that cannot be verified fails closed."""
    a, cls, fails = policy["assets"], policy["assets"]["classes"][asset_class], []
    try:
        path = asset_path(root, entry["path"])
    except AssetError as exc:
        return [str(exc)]
    if not os.path.isfile(path):
        return ["asset file does not exist: %s" % entry["path"]]
    ext = path.rsplit(".", 1)[-1].lower()
    if ext not in cls["formats"]:
        fails.append("format %s is not allowed" % ext)
    size = os.path.getsize(path)
    if size > cls["max_bytes"]:
        fails.append("file size %d exceeds %d bytes" % (size, cls["max_bytes"]))
    if sha256_file(path) != entry.get("checksum"):
        fails.append("checksum does not match the manifest")
    lic = entry.get("license", "")
    if not lic or AMBIGUOUS_LICENSE.search(lic):
        fails.append("license is unknown or ambiguous: %r" % lic)
    elif lic not in a["allowed_licenses"]:
        fails.append("license %r is not allowed by the policy" % lic)
    if lic in a.get("attribution_required_licenses", []) and not entry.get("attribution"):
        fails.append("attribution is required for %s" % lic)
    for field in ("request_id", "issue", "source", "author", "date", "tool"):
        if not entry.get(field):
            fails.append("manifest field %r is missing" % field)
    with open(path, "rb") as fh:
        raw = fh.read()
    if ABS_PATH.search(raw.decode("latin-1")) or EMBEDDED_CODE.search(raw) or SECRET_BYTES.search(raw):
        fails.append("file contains an absolute path, embedded script, or credential")
    try:
        if ext in ("glb", "gltf"):
            stats = gltf_stats(path)
            if stats["triangles"] > cls.get("max_triangles", stats["triangles"]):
                fails.append("%d triangles exceed %d" % (stats["triangles"], cls["max_triangles"]))
            if "max_bbox_m" in cls and stats["extent"] is not None and stats["extent"] > cls["max_bbox_m"]:
                fails.append("bounding box extent %s exceeds %s" % (stats["extent"], cls["max_bbox_m"]))
            if "max_bbox_m" in cls and stats["extent"] is None:
                fails.append("bounding box cannot be verified")
            for u in stats["uris"]:
                if u.startswith(("/", "file:", "http")) or re.match(r"^[A-Za-z]:", u):
                    fails.append("external or absolute URI in the asset: %s" % u[:60])
            for d in stats["image_dims"]:
                if d is None or max(d) > cls.get("max_texture_px", 10**9):
                    fails.append("embedded texture exceeds %s px or cannot be read" % cls.get("max_texture_px"))
        elif ext in ("png", "jpg", "jpeg"):
            dims = image_dims(raw)
            if dims is None:
                fails.append("image dimensions cannot be read")
            elif max(dims) > cls.get("max_texture_px", 10**9):
                fails.append("texture %dx%d exceeds %d px" % (dims[0], dims[1], cls["max_texture_px"]))
        elif "max_texture_px" in cls or "max_triangles" in cls:
            fails.append("limits cannot be verified for format %s" % ext)
    except (AssetError, KeyError, IndexError, ValueError, struct.error) as exc:
        fails.append("asset cannot be inspected: %s" % exc)
    return fails


# -- Blender -------------------------------------------------------------------------------

def screen_script(text: str) -> List[str]:
    """Static screen for procedural scripts. Defense in depth only: Blender runs Python with the operator's privileges."""
    return ["forbidden construct: %s" % m.group(0).strip() for m in SCRIPT_BLOCKLIST.finditer(text)][:5]


class BlenderRunner:
    def probe(self) -> Dict[str, Any]:
        raise NotImplementedError

    def run_script(self, script: str, output_file: str, timeout: int = 300) -> Dict[str, Any]:
        raise NotImplementedError


def _mcp_entry_present() -> bool:
    home = os.path.expanduser("~")
    for path in (os.path.join(home, "Library", "Application Support", "Code", "User", "mcp.json"), os.path.join(home, ".copilot", "mcp-config.json"),
                 os.path.join(home, ".copilot", "config.json"), ".vscode/mcp.json"):
        try:
            with open(path, encoding="utf-8") as fh:
                if "blender" in fh.read().lower():
                    return True
        except OSError:
            continue
    return False


class BlenderCli(BlenderRunner):
    """Headless `blender --background --factory-startup`. It never opens the unauthenticated MCP socket."""

    def __init__(self, binary: str = "blender", *, reviewed_scripts: Sequence[str] = ()):
        self.binary = shutil.which(binary) or (binary if os.path.isfile(binary) else None)
        self._reviewed_scripts = frozenset(reviewed_scripts)

    def probe(self) -> Dict[str, Any]:
        """Read-only. Connecting to the MCP port sends nothing."""
        info: Dict[str, Any] = {"blender": self.binary, "uv": shutil.which("uv"), "mcp_server_entry": _mcp_entry_present()}
        with socket.socket() as s:
            s.settimeout(0.5)
            info["mcp_addon_socket_9876"] = s.connect_ex(("127.0.0.1", 9876)) == 0
        version = None
        if self.binary:
            try:
                out = subprocess.run([self.binary, "--version"], capture_output=True, text=True, timeout=30, env=scrub_env(os.environ))
                version = out.stdout.splitlines()[0] if out.returncode == 0 and out.stdout else None
            except (OSError, subprocess.TimeoutExpired):
                version = None
        info["version"] = version
        info["available"] = bool(version)
        info["reason"] = "headless Blender runs scripts" if version else ("blender is not installed" if not self.binary else "blender did not report a version")
        info["note"] = "CC0 library search and import need the MCP server and are not available through the headless runner"
        return info

    def run_script(self, script: str, output_file: str, timeout: int = 300) -> Dict[str, Any]:
        if script not in self._reviewed_scripts:
            return {"ok": False, "reason": "host-side procedural scripts require trusted human review; provide the generated asset instead"}
        problems = screen_script(script)
        if problems:
            return {"ok": False, "reason": "script rejected: %s" % problems}
        if not self.binary:
            return {"ok": False, "reason": "blender is not installed"}
        work = tempfile.mkdtemp(prefix="harness-blender-")
        try:
            path = os.path.join(work, "asset.py")
            with open(path, "w") as fh:
                fh.write("OUTPUT_PATH = %r\n%s" % (output_file, script))
            env = scrub_env(os.environ)
            env["HARNESS_ASSET_OUT"] = output_file
            env["DISABLE_TELEMETRY"] = "true"
            proc = subprocess.run([self.binary, "--background", "--factory-startup", "--python-exit-code", "1", "--python", path],
                                  cwd=work, env=env, capture_output=True, text=True, timeout=timeout)
            ok = proc.returncode == 0 and os.path.isfile(output_file)
            return {"ok": ok, "reason": "" if ok else "blender exited %d: %s" % (proc.returncode, proc.stderr.strip()[-200:]),
                    "tool_version": (proc.stdout.splitlines() or [""])[0][:80]}
        except subprocess.TimeoutExpired:
            return {"ok": False, "reason": "blender timed out after %ds" % timeout}
        finally:
            shutil.rmtree(work, ignore_errors=True)


# -- service ---------------------------------------------------------------------------------

class AssetService:
    def __init__(self, store: Store, plan_id: str, policy: Dict[str, Any], repo_root: str, runner: Optional[BlenderRunner] = None,
                 owner: str = "owner", secondary_owner: Optional[str] = None):
        self.store, self.plan_id, self.policy, self.root = store, plan_id, policy, repo_root
        self.runner, self.owner, self.secondary_owner = runner, owner, secondary_owner

    @property
    def manifest_path(self) -> str:
        return asset_path(self.root, str(Path(self.policy["assets"]["output_dir"]) / "manifest.json"))

    def manifest(self) -> Dict[str, Any]:
        try:
            with open(self.manifest_path) as fh:
                return json.load(fh)
        except (OSError, ValueError):
            return {"version": 1, "entries": []}

    def _write_manifest(self, entry: Dict[str, Any]) -> None:
        doc = self.manifest()
        doc["entries"] = [e for e in doc["entries"] if e["request_id"] != entry["request_id"]] + [entry]
        doc["entries"].sort(key=lambda e: e["path"])
        os.makedirs(os.path.dirname(self.manifest_path), exist_ok=True)
        tmp = asset_path(self.root, str(Path(self.policy["assets"]["output_dir"]) / "manifest.json.tmp"))
        with open(tmp, "w") as fh:
            json.dump(doc, fh, indent=2, sort_keys=True)
        os.replace(tmp, self.manifest_path)

    def _entry(self, req: Dict[str, Any], source: str, tool: str, **kw: Any) -> Dict[str, Any]:
        path = os.path.normpath(req["output_path"])
        lib = req.get("library") or {}
        entry = {"path": path, "checksum": sha256_file(asset_path(self.root, path)), "request_id": req["request_id"], "issue": req["issue_id"],
                 "source": source, "source_id": lib.get("source_id", ""), "url": lib.get("url", ""), "author": lib.get("author", "harness"),
                 "license": lib.get("license", "CC0-1.0" if source == "procedural" else ""), "attribution": lib.get("attribution", ""),
                 "tool": tool, "tool_version": "", "generator": req.get("generator", ""), "script_ref": "", "prompt": req.get("prompt", ""),
                 "deterministic": source != "ai", "date": time.strftime("%Y-%m-%d", time.gmtime())}
        entry.update(kw)
        return entry

    def handle(self, req: Dict[str, Any], now: float) -> Dict[str, Any]:
        problems = validate_request(self.policy, req, self.root)
        if problems:
            telemetry.emit(self.store, "asset_rejected", issue_id=req.get("issue_id", ""), data={"problems": problems}, now=now)
            return {"status": "rejected", "problems": problems}
        key = req["request_id"]
        rec = self.store.get_doc("asset", key) or {"status": "new", "validation_failures": 0, "tried": []}
        if rec["status"] in ("delivered", "task_raised"):
            return rec
        tried: List[Dict[str, str]] = []
        for source in SOURCE_ORDER:
            if source not in self.policy["assets"]["allowed_sources"] and source != "ai":
                continue
            if source == "repository":
                result = self._repository(req, tried)
            elif source == "cc0_library":
                tried.append({"source": source, "reason": "CC0 library search and import need the Blender MCP server, which is not connected"})
                result = None
            elif source == "procedural":
                result = self._procedural(req, tried)
            else:
                result = self._ai(req, tried)
            if result is None:
                continue
            fails = validate_entry(self.root, result, self.policy, req["asset_class"])
            if not fails:
                self._write_manifest(result)
                rec.update(status="delivered", path=result["path"], source=source, tried=tried)
                self.store.put_doc("asset", key, rec)
                telemetry.emit(self.store, "asset_delivered", issue_id=req["issue_id"], data={"request": key, "source": source}, now=now)
                if self.policy["assets"].get("visual_fit_needs_human"):
                    rec["review_task"] = self._raise_visual_review(req, result, now)
                    self.store.put_doc("asset", key, rec)
                return dict(rec, manifest_entry=result)
            self._discard(req, source)
            rec["validation_failures"] += 1
            tried.append({"source": source, "reason": "validation failed: %s" % "; ".join(fails)[:300]})
            if rec["validation_failures"] >= 2:
                break
        rec.update(tried=tried)
        failed_now = any(t["reason"].startswith("validation failed") for t in tried)
        if failed_now and rec["validation_failures"] < 2:
            self.store.put_doc("asset", key, rec)
            return dict(rec, status="validation_failed")  # the worker may revise the request once more
        return self._raise_task(req, rec, tried, now)

    def _discard(self, req: Dict[str, Any], source: str) -> None:
        if source == "procedural":
            try:
                os.remove(asset_path(self.root, req["output_path"]))
            except (OSError, AssetError):
                pass

    def _repository(self, req, tried):
        existing = req.get("existing_path")
        if not existing:
            tried.append({"source": "repository", "reason": "no existing repository asset was named"})
            return None
        norm = os.path.normpath(existing)
        out_dir = os.path.normpath(self.policy["assets"]["output_dir"])
        try:
            full = asset_path(self.root, existing)
        except AssetError as exc:
            tried.append({"source": "repository", "reason": str(exc)})
            return None
        if os.path.isabs(norm) or norm.startswith("..") or not (norm + os.sep).startswith(out_dir + os.sep) or not os.path.isfile(full):
            tried.append({"source": "repository", "reason": "named file is not an asset inside %s" % out_dir})
            return None
        known = next((e for e in self.manifest()["entries"] if e["path"] == norm), None)
        if known is None:
            tried.append({"source": "repository", "reason": "the existing asset has no manifest entry, so its license is unknown"})
            return None
        return dict(known, request_id=req["request_id"], issue=req["issue_id"], checksum=sha256_file(full))

    def _procedural(self, req, tried):
        if not req.get("script"):
            tried.append({"source": "procedural", "reason": "no script was supplied"})
            return None
        if self.runner is None or not self.runner.probe().get("available"):
            tried.append({"source": "procedural", "reason": "Blender is unavailable"})
            return None
        out = asset_path(self.root, req["output_path"])
        script_ref = str(Path(self.policy["assets"]["output_dir"]) / "scripts" / (req["request_id"] + ".py"))
        script_path = asset_path(self.root, script_ref)
        os.makedirs(os.path.dirname(out), exist_ok=True)
        res = self.runner.run_script(req["script"], out)
        if not res["ok"]:
            tried.append({"source": "procedural", "reason": res["reason"]})
            return None
        os.makedirs(os.path.dirname(script_path), exist_ok=True)
        with open(script_path, "w") as fh:
            fh.write(req["script"])
        return self._entry(req, "procedural", "blender", tool_version=res.get("tool_version", ""), script_ref=script_ref)

    def _ai(self, req, tried):
        credits = self.policy["assets"]["paid_generation_credits"]
        tried.append({"source": "ai", "reason": "no paid-generation budget" if credits <= 0 else "no generation provider is configured"})
        return None

    def _raise_visual_review(self, req: Dict[str, Any], entry: Dict[str, Any], now: float) -> str:
        """The policy marks visual fit as needing human judgment. Previews need Blender, so the asset file itself is attached."""
        task_id = "asset-review-%s" % req["request_id"]
        humantasks.request_task(
            self.store, task_id=task_id, kind="manual_test", issue_ids=[req["issue_id"]], owner=self.owner, secondary_owner=self.secondary_owner, now=now,
            block_issues=False, why="Visual fit of %s needs human judgment." % entry["path"],
            request="Open %s (checksum %s) and judge whether it fits: %s" % (entry["path"], entry["checksum"][:12], req.get("style_notes", req["purpose"])),
            response_format={"required": ["outcome", "tester", "revision"], "outcome": ["pass", "fail", "inconclusive"]},
            resolution_criteria="Report pass, fail, or inconclusive for this exact file. Revision is its checksum.",
            extra={"bind": "asset", "tested_head": entry["checksum"], "asset_abspath": os.path.join(self.root, entry["path"]),
                   "evidence_required": [], "reason": "visual_judgment"})
        return task_id

    def _raise_task(self, req: Dict[str, Any], rec: Dict[str, Any], tried: List[Dict[str, str]], now: float) -> Dict[str, Any]:
        reasons = "; ".join("%s: %s" % (t["source"], t["reason"]) for t in tried)
        task_id = "asset-%s" % req["request_id"]
        humantasks.request_task(
            self.store, task_id=task_id, kind="asset", issue_ids=[req["issue_id"]], owner=self.owner, secondary_owner=self.secondary_owner, now=now,
            why="An asset is needed for %s: %s. No automated source produced a valid asset." % (req["issue_id"], req["purpose"]),
            request="Provide %s (%s, up to the policy limits) for %s. Sources tried: %s" % (req["asset_class"], req["format"], req["output_path"], reasons),
            response_format={"required": ["source", "license", "author"], "optional": ["url", "attribution", "source_id"], "artifact": "the asset file"},
            resolution_criteria="The file passes automated validation: allowed format, size and polygon limits, an allowed license, and a provenance record.",
            extra={"request": {k: v for k, v in req.items() if k not in ("script", "prompt")}, "tried": tried, "asset_class": req["asset_class"]})
        rec.update(status="task_raised", task=task_id, tried=tried)
        self.store.put_doc("asset", req["request_id"], rec)
        telemetry.emit(self.store, "asset_task_raised", issue_id=req["issue_id"], data={"request": req["request_id"], "tried": len(tried)}, now=now)
        return dict(rec, status="task_raised")

    def accept_human_asset(self, task: Dict[str, Any], answers: Dict[str, Any], artifacts: Sequence[str]) -> Optional[str]:
        """Validator for a human-supplied asset. Returns a problem string, or None after copying the file and writing the manifest."""
        req = task["payload"]["extra"]["request"]
        problems = validate_request(self.policy, dict(req, source="repository"), self.root)
        if problems:
            return problems[0]
        dest = asset_path(self.root, req["output_path"])
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        shutil.copyfile(artifacts[0], dest)
        entry = self._entry(dict(req, library={"license": answers["license"], "author": answers["author"], "url": answers.get("url", ""),
                                               "attribution": answers.get("attribution", ""), "source_id": answers.get("source_id", "")}),
                            answers["source"], "human-supplied")
        fails = validate_entry(self.root, entry, self.policy, req["asset_class"])
        if fails:
            os.remove(dest)
            return "; ".join(fails)[:300]
        self._write_manifest(entry)
        return None
