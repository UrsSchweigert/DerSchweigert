"""The art service: image generation for workers, with the key and the budget on the trusted side.

A worker session is one-shot, so it cannot ask the broker for an asset and wait. Instead `harness run` starts this small
HTTP service on the owner's machine, bound to loopback, and the worker image carries an `art-generate` command that
calls it through `host.docker.internal`. What a worker can influence is bounded here, in trusted code:

* The fal key never reaches a container. The worker holds only the service address and a random per-run token, which is
  worth no more than the budget left in the plan.
* The model is the plan's `art.generator`. A worker cannot name another one.
* Every call is counted against the plan's `art.credits`. The ledger lives in the store folder (mode 0600), so the budget
  survives a restart, and a failed generation is refunded because fal bills only what it delivers.
* Every call is recorded (prompt, seed, model, checksum, issue) so the art's provenance does not depend on what a
  worker writes in a document.
* Prompts are screened for secrets, references must be small PNG files, and the output size is a fixed square.

Only loopback is served: nothing outside this computer can reach it, and the sandbox reaches it only through the host
gateway name.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import tempfile
import threading
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Callable, Dict, Optional

from .broker import assert_no_secrets, BrokerRejected
from .plans import art_policy_problems

LEDGER_PREFIX = "art-ledger-"
MAX_PROMPT_CHARS = 4000
MAX_REFERENCES = 2
MAX_REFERENCE_BYTES = 2_500_000
MAX_BODY_BYTES = 12_000_000
MAX_OUTPUT_BYTES = 12_000_000
SIZES = (512, 768, 1024)
MAX_CONCURRENT = 2
GENERATE_TIMEOUT_S = 240
PNG_MAGIC = b"\x89PNG\r\n\x1a\n"
CONTAINER_HOST = "host.docker.internal"

ENV_URL = "ART_SERVICE_URL"
ENV_TOKEN = "ART_SERVICE_TOKEN"


class ArtRejected(Exception):
    """A request the policy or the limits refuse. `status` is the HTTP status the worker's command sees."""

    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


class ArtUnavailable(Exception):
    """The generator failed. The budget is refunded and the worker may try again."""


# -- policy ---------------------------------------------------------------------------------

def enabled(policy: Dict[str, Any]) -> bool:
    """Whether a plan switches art generation on: a valid `art` block with a generator and a budget."""
    art = policy.get("art")
    return isinstance(art, dict) and not art_policy_problems(art)


# -- the ledger -------------------------------------------------------------------------------

class Ledger:
    """Spend and provenance for one plan, in a 0600 JSON file written atomically under a lock."""

    def __init__(self, home: str, plan_id: str, credits: int):
        self.path = os.path.join(home, LEDGER_PREFIX + re.sub(r"[^A-Za-z0-9._-]", "_", plan_id) + ".json")
        self.credits = credits
        self._lock = threading.Lock()

    def _read(self) -> Dict[str, Any]:
        try:
            with open(self.path, encoding="utf-8") as fh:
                doc = json.load(fh)
            if isinstance(doc, dict) and isinstance(doc.get("calls"), list):
                return doc
        except (OSError, ValueError):
            pass
        return {"calls": []}

    def _write(self, doc: Dict[str, Any]) -> None:
        handle, tmp = tempfile.mkstemp(dir=os.path.dirname(self.path), prefix="art-ledger-", suffix=".tmp")
        try:
            with os.fdopen(handle, "w", encoding="utf-8") as fh:
                json.dump(doc, fh, indent=1, sort_keys=True)
                fh.write("\n")
            os.chmod(tmp, 0o600)
            os.replace(tmp, self.path)
        except BaseException:
            if os.path.exists(tmp):
                os.remove(tmp)
            raise

    @staticmethod
    def _spent(doc: Dict[str, Any]) -> int:
        return sum(1 for call in doc["calls"] if call.get("status") in ("reserved", "delivered"))

    def remaining(self) -> int:
        with self._lock:
            return self.credits - self._spent(self._read())

    def reserve(self, entry: Dict[str, Any]) -> Dict[str, Any]:
        """Take one credit before the paid call, so concurrent calls can never overspend."""
        with self._lock:
            doc = self._read()
            if self._spent(doc) >= self.credits:
                raise ArtRejected("the art budget of %d images is used up" % self.credits, 402)
            entry = dict(entry, call_id="art-%04d" % (len(doc["calls"]) + 1), status="reserved", at=time.time())
            doc["calls"].append(entry)
            self._write(doc)
            return entry

    def settle(self, call_id: str, **fields: Any) -> None:
        with self._lock:
            doc = self._read()
            for call in doc["calls"]:
                if call["call_id"] == call_id:
                    call.update(fields)
            self._write(doc)

    def summary(self) -> Dict[str, Any]:
        with self._lock:
            doc = self._read()
        delivered = [c for c in doc["calls"] if c.get("status") == "delivered"]
        return {"credits": self.credits, "used": self._spent(doc), "remaining": self.credits - self._spent(doc),
                "delivered": len(delivered), "failed": sum(1 for c in doc["calls"] if c.get("status") == "failed"),
                "calls": doc["calls"]}


# -- generation -------------------------------------------------------------------------------

def fal_generate(model: str, arguments: Dict[str, Any]) -> Dict[str, Any]:
    """One real fal call. Returns {"png": bytes, "seed": ...}. The key is resolved here, on the trusted side only."""
    import fal_client  # noqa: PLC0415 - the harness works without it until art is switched on
    import fal_image  # noqa: PLC0415

    os.environ["FAL_KEY"] = fal_image.resolve_key(None)
    result = fal_client.subscribe(model, arguments=arguments, with_logs=False)
    images = (result or {}).get("images") or []
    if not images or not images[0].get("url"):
        raise ArtUnavailable("fal returned no image")
    with urllib.request.urlopen(images[0]["url"], timeout=60) as response:  # noqa: S310 - the URL comes from fal
        png = response.read(MAX_OUTPUT_BYTES + 1)
    if len(png) > MAX_OUTPUT_BYTES:
        raise ArtUnavailable("the generated image is larger than %d bytes" % MAX_OUTPUT_BYTES)
    return {"png": png, "seed": result.get("seed", "unknown")}


class ArtService:
    def __init__(self, home: str, plan_id: str, art: Dict[str, Any], generate: Optional[Callable[[str, Dict[str, Any]], Dict[str, Any]]] = None,
                 token: Optional[str] = None, port: int = 0):
        problems = art_policy_problems(art)
        if problems:
            raise ValueError("; ".join(problems))
        self.plan_id, self.model = plan_id, art["generator"]
        self.ledger = Ledger(home, plan_id, art["credits"])
        self.token = token or secrets.token_urlsafe(32)
        self._generate = generate or fal_generate
        self._slots = threading.BoundedSemaphore(MAX_CONCURRENT)
        self._server = ThreadingHTTPServer(("127.0.0.1", port), _handler(self))
        self._server.daemon_threads = True
        self._thread: Optional[threading.Thread] = None

    # -- lifecycle -------------------------------------------------------------------------------
    @property
    def port(self) -> int:
        return self._server.server_address[1]

    def container_env(self) -> Dict[str, str]:
        """What a worker container receives: where to call, and the token. Never the fal key."""
        return {ENV_URL: "http://%s:%d" % (CONTAINER_HOST, self.port), ENV_TOKEN: self.token}

    def start(self) -> "ArtService":
        self._thread = threading.Thread(target=self._server.serve_forever, kwargs={"poll_interval": 0.2}, daemon=True)
        self._thread.start()
        return self

    def stop(self) -> None:
        self._server.shutdown()
        self._server.server_close()

    # -- one request -----------------------------------------------------------------------------
    def check(self, body: Dict[str, Any]) -> Dict[str, Any]:
        """Validate a worker's request and return the fal arguments. Raises ArtRejected."""
        if not isinstance(body, dict):
            raise ArtRejected("the request must be a JSON object")
        prompt = body.get("prompt")
        if not isinstance(prompt, str) or not prompt.strip() or len(prompt) > MAX_PROMPT_CHARS:
            raise ArtRejected("prompt must be text of 1 to %d characters" % MAX_PROMPT_CHARS)
        try:
            assert_no_secrets({"prompt": prompt}, "art request")
        except BrokerRejected as exc:
            raise ArtRejected(str(exc))
        size = body.get("size", 1024)
        if size not in SIZES:
            raise ArtRejected("size must be one of %s" % ", ".join(str(s) for s in SIZES))
        seed = body.get("seed")
        if seed is not None and (type(seed) is not int or not 0 <= seed < 2**31):
            raise ArtRejected("seed must be a whole number below 2147483648")
        references = body.get("references") or []
        if not isinstance(references, list) or len(references) > MAX_REFERENCES:
            raise ArtRejected("at most %d reference images are allowed" % MAX_REFERENCES)
        urls = []
        for index, item in enumerate(references):
            try:
                raw = base64.b64decode(item, validate=True)
            except (TypeError, ValueError):
                raise ArtRejected("reference %d is not valid base64" % (index + 1))
            if not raw.startswith(PNG_MAGIC) or len(raw) > MAX_REFERENCE_BYTES:
                raise ArtRejected("reference %d must be a PNG of at most %d bytes" % (index + 1, MAX_REFERENCE_BYTES))
            urls.append("data:image/png;base64," + item)
        arguments: Dict[str, Any] = {"prompt": prompt, "image_size": {"width": size, "height": size}, "output_format": "png"}
        if seed is not None:
            arguments["seed"] = seed
        if urls:
            arguments["image_url"] = urls[0]  # kontext edits one reference; a second one is kept for models that take several
            if len(urls) > 1:
                arguments["image_urls"] = urls
        return arguments

    def save_image(self, call_id: str, png: bytes) -> Optional[str]:
        """Keep a delivered image in the store folder (mode 0600). A failure to save never costs the worker its paid image."""
        try:
            folder = os.path.join(os.path.dirname(self.ledger.path), "art-images", re.sub(r"[^A-Za-z0-9._-]", "_", self.plan_id))
            os.makedirs(folder, mode=0o700, exist_ok=True)
            target = os.path.join(folder, call_id + ".png")
            with open(os.open(target, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), "wb") as fh:
                fh.write(png)
            return target
        except OSError:
            return None

    def generate(self, body: Dict[str, Any]) -> Dict[str, Any]:
        arguments = self.check(body)
        entry = self.ledger.reserve({
            "issue_id": str(body.get("issue_id") or "")[:80], "label": str(body.get("label") or "")[:120],
            "model": self.model, "prompt": body["prompt"], "references": len(body.get("references") or [])})
        call_id = entry["call_id"]
        if not self._slots.acquire(timeout=GENERATE_TIMEOUT_S):
            self.ledger.settle(call_id, status="failed", error="busy")
            raise ArtRejected("the art service is busy; try again", 503)
        try:
            result = self._generate(self.model, arguments)
        except Exception as exc:  # noqa: BLE001 - any failure of the paid call refunds the credit
            self.ledger.settle(call_id, status="failed", error=str(exc)[:300])
            raise ArtUnavailable(str(exc)[:300])
        finally:
            self._slots.release()
        png = result.get("png") or b""
        if not png.startswith(PNG_MAGIC):
            self.ledger.settle(call_id, status="failed", error="the generator did not return a PNG")
            raise ArtUnavailable("the generator did not return a PNG")
        digest = hashlib.sha256(png).hexdigest()
        # Every image is kept for the owner, whatever the worker decides about it: a worker that rejects its own tries
        # leaves nothing else to look at, and the first three adventurer tries were lost exactly that way.
        saved = self.save_image(call_id, png)
        self.ledger.settle(call_id, status="delivered", seed=result.get("seed"), sha256=digest, bytes=len(png), file=saved)
        return {"call_id": call_id, "model": self.model, "seed": result.get("seed"), "sha256": digest,
                "remaining": self.ledger.remaining(), "png": base64.b64encode(png).decode("ascii")}


def _handler(service: ArtService):
    class Handler(BaseHTTPRequestHandler):
        server_version = "art-service"

        def log_message(self, *args: Any) -> None:  # the service never prints prompts or tokens
            return

        def _send(self, status: int, doc: Dict[str, Any]) -> None:
            data = json.dumps(doc).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def _authorized(self) -> bool:
            given = self.headers.get("Authorization", "")
            return given.startswith("Bearer ") and hmac.compare_digest(given[7:].encode(), service.token.encode())

        def do_GET(self) -> None:  # noqa: N802
            if not self._authorized():
                return self._send(401, {"error": "unauthorized"})
            if self.path == "/v1/status":
                summary = service.ledger.summary()
                return self._send(200, {k: summary[k] for k in ("credits", "used", "remaining", "delivered", "failed")} | {"model": service.model})
            self._send(404, {"error": "not found"})

        def do_POST(self) -> None:  # noqa: N802
            if not self._authorized():
                return self._send(401, {"error": "unauthorized"})
            if self.path != "/v1/generate":
                return self._send(404, {"error": "not found"})
            try:
                length = int(self.headers.get("Content-Length", "0"))
            except ValueError:
                length = -1
            if not 0 < length <= MAX_BODY_BYTES:
                return self._send(413, {"error": "the request body must be 1 to %d bytes" % MAX_BODY_BYTES})
            try:
                body = json.loads(self.rfile.read(length))
                self._send(200, service.generate(body))
            except ValueError:
                self._send(400, {"error": "the request is not valid JSON"})
            except ArtRejected as exc:
                self._send(exc.status, {"error": str(exc)})
            except ArtUnavailable as exc:
                self._send(502, {"error": "generation failed: %s" % exc})

    return Handler
