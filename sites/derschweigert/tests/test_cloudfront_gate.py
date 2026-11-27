"""Test the CloudFront viewer-request function for www.derschweigert.de.

The function is extracted from Terraform (infra/terraform/sites/derschweigert/main.tf)
and run in Node.js. Since 2026-11-18 it only rewrites the extensionless URLs of pages
that are uploaded as .html objects (legal pages, /ovara, /cupmark); the retired PIN gate
and /contact 410 must not return.
"""

import json
import re
import subprocess
from pathlib import Path

TF_FILE = Path(__file__).parent.parent.parent.parent / "infra" / "terraform" / "sites" / "derschweigert" / "main.tf"


def extract_tf_function() -> str:
    """Extract the viewer_request_function_code heredoc from Terraform."""
    content = TF_FILE.read_text()
    match = re.search(r"viewer_request_function_code\s*=\s*<<-EOF\n(.*?)\n\s*EOF", content, re.DOTALL)
    if not match:
        raise ValueError("Could not find viewer_request_function_code in Terraform file")
    return match.group(1)


def run_function(uris: list[str], cookie: str | None = None) -> list[dict]:
    """Run the handler once per URI and return the resulting status and request URI."""
    script = (
        "const uris = " + json.dumps(uris) + ";\n"
        "const cookie = " + json.dumps(cookie) + ";\n"
        + extract_tf_function()
        + """
const results = uris.map((uri) => {
  const event = { request: {
    uri,
    headers: { host: { value: 'www.derschweigert.de' }, cookie: cookie ? { value: cookie } : undefined },
    cookies: cookie ? { ams_pin: { value: '1' } } : {},
  } };
  const result = handler(event);
  return { uri, status: result.statusCode || 200, requestUri: event.request.uri, location: result.headers?.location?.value };
});
console.log(JSON.stringify(results));
"""
    )
    proc = subprocess.run(["node", "-e", script], capture_output=True, text=True, check=False)
    if proc.returncode != 0:
        raise RuntimeError(f"Node.js execution failed: {proc.stderr}")
    return json.loads(proc.stdout)


def test_legal_pages_are_rewritten_to_their_html_objects():
    results = run_function(["/impressum", "/datenschutz", "/nutzungsbedingungen"])
    assert [r["requestUri"] for r in results] == ["/impressum.html", "/datenschutz.html", "/nutzungsbedingungen.html"]
    assert all(r["status"] == 200 and r.get("location") is None for r in results)


def test_ovara_page_is_rewritten_to_its_html_object():
    result = run_function(["/ovara"])[0]
    assert result["requestUri"] == "/ovara.html"


def test_cupmark_pages_are_rewritten_to_their_html_objects():
    results = run_function(["/cupmark", "/cupmark/en"])
    assert [r["requestUri"] for r in results] == ["/cupmark.html", "/cupmark/en.html"]


def test_every_other_path_passes_through_unchanged_without_a_gate():
    paths = ["/", "/services/websites", "/static/app.js", "/unlock", "/contact", "/admin.html", "/cupmarkx"]
    for cookie in (None, "ams_pin=1"):
        results = run_function(paths, cookie)
        assert [r["requestUri"] for r in results] == paths
        assert all(r["status"] == 200 and r.get("location") is None for r in results), results


def test_the_retired_pin_gate_does_not_come_back():
    code = extract_tf_function()
    assert "ams_pin" not in code
    assert "/unlock" not in code
    assert "pin_protection_enabled" not in TF_FILE.read_text()
