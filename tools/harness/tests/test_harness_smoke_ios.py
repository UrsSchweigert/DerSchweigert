"""The trusted iOS shell smoke check: when it runs, and what it refuses.

The script is the authority on the shape of the shipped app, so these tests run the real script
(POSIX sh plus the Python standard library, no container, no network) against built fixtures.
"""
import json
import os
import plistlib
import shutil
import subprocess

import pytest

from harness import broker, plans, smoke

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
SCRIPT = os.path.join(ROOT, "tools", "harness", "worker", "smoke", "ios_shell.sh")
COMMAND = "sh /opt/harness/smoke/ios_shell.sh /work sites/lesen"

CONFIG = {
    "appId": "de.derschweigert.buchstabenzeit",
    "appName": "Buchstabenzeit",
    "webDir": "www",
    "server": {"androidScheme": "https"},
}

INFO = {
    "CFBundleIdentifier": "$(PRODUCT_BUNDLE_IDENTIFIER)",
    "CFBundleLocalizations": ["de", "en"],
    "CFBundleName": "Buchstabenzeit",
    "CFBundleVersion": "1",
    "CFBundleShortVersionString": "0.1.0",
}

PRIVACY = {
    "NSPrivacyTracking": False,
    "NSPrivacyTrackingDomains": [],
    "NSPrivacyCollectedDataTypes": [],
    "NSPrivacyAccessedAPITypes": [
        {"NSPrivacyAccessedAPIType": "NSPrivacyAccessedAPICategoryFileTimestamp",
         "NSPrivacyAccessedAPITypeReasons": ["C617.1"]},
        {"NSPrivacyAccessedAPIType": "NSPrivacyAccessedAPICategoryUserDefaults",
         "NSPrivacyAccessedAPITypeReasons": ["CA92.1"]},
    ],
}

PBXPROJ = """// !$*UTF8*$!
{
/* Begin PBXResourcesBuildPhase section */
\t504EC3011FED79650016851F /* Resources */ = {
\t\tisa = PBXResourcesBuildPhase;
\t\tfiles = (
\t\t\t2FAD9762203C412B000D30F8 /* config.xml in Resources */,
\t\t\t50B271D01FEDC1A000F3C39B /* public in Resources */,
\t\t\tA1B2C3D41FEDC1A000F3C39B /* PrivacyInfo.xcprivacy in Resources */,
\t\t);
\t\trunOnlyForDeploymentPostprocessing = 0;
\t};
/* End PBXResourcesBuildPhase section */
}
"""

INDEX = """<!doctype html>
<html lang="de"><head><meta charset="utf-8"><title>Buchstabenzeit</title>
<link rel="icon" href="favicon.png">
<style>@font-face { font-family: Andika; src: url("fonts/andika.woff2") format("woff2"); }</style>
</head><body>
<img src="images/logo.png" alt="logo">
<a href="datenschutz.html">Datenschutz</a>
<script type="module">
import { createStorage } from './storage.mjs'
const worker = new Worker('./counts-worker.mjs', { type: 'module' })
</script>
</body></html>
"""

PRIVACY_PAGE = """<!doctype html><html lang="de"><head><meta charset="utf-8"><title>Datenschutz</title></head>
<body><a href="https://derschweigert.de/impressum">Impressum</a>
<a href="https://www.lda.bayern.de/de/beschwerde.html">Beschwerde</a>
<a href="index.html">zur\u00fcck</a></body></html>
"""


REQUIRED = [
    "index.html", "favicon.png", "apple-touch-icon.png",
    "platform.mjs", "storage.mjs", "sounds.mjs", "scoring.mjs", "coverage.mjs", "i18n.mjs",
    "speech-adapter.js", "speech-offline-filter.mjs", "counts-compute.mjs", "counts-worker.mjs",
    "sentences/cards.mjs", "sentences/de.json", "sentences/en.json",
    "words-de.json", "words-en.json", "words-de-LICENSE.txt", "words-en-LICENSE.txt",
    "fonts/OFL.txt", "fonts/andika-latin-regular.woff2", "fonts/andika-latin-bold.woff2",
    "images/buchstabenzeit-logo.png", "datenschutz.html", "datenschutz-en.html", "books/README.md",
]


def fill_bundle(bundle):
    """A bundle that carries the whole runtime inventory, like the shipped one."""
    for rel in REQUIRED:
        path = bundle / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        if rel == "index.html":
            path.write_text(INDEX)
        elif rel in ("datenschutz.html", "datenschutz-en.html"):
            path.write_text(PRIVACY_PAGE)
        elif rel.endswith((".mjs", ".js")):
            path.write_text("export const x = 1\n")
        elif rel.endswith(".json"):
            path.write_text("{}\n")
        elif rel.endswith((".txt", ".md")):
            path.write_text("text\n")
        else:
            path.write_bytes(b"\x89PNG\r\n")
    (bundle / "images").mkdir(exist_ok=True)
    (bundle / "images/logo.png").write_bytes(b"\x89PNG\r\n")
    (bundle / "fonts/andika.woff2").write_bytes(b"wOF2")
    (bundle / "storage.mjs").write_text("export const createStorage = () => ({})\n")
    (bundle / "counts-worker.mjs").write_text("import { createStorage } from './storage.mjs'\n")
    return bundle


def build(tmp_path, project="sites/lesen"):
    """A complete, offline-correct Capacitor project with an iOS shell."""
    base = tmp_path / project
    (base / "scripts").mkdir(parents=True)
    (base / "scripts/copy-assets.mjs").write_text("const dest = join(root, 'www')\n")
    (base / "capacitor.config.json").write_text(json.dumps(CONFIG, indent=2))

    fill_bundle(base / "static")

    app = base / "ios/App/App"
    app.mkdir(parents=True)
    with open(app / "Info.plist", "wb") as fh:
        plistlib.dump(INFO, fh)
    with open(app / "PrivacyInfo.xcprivacy", "wb") as fh:
        plistlib.dump(PRIVACY, fh)
    xcodeproj = base / "ios/App/App.xcodeproj"
    xcodeproj.mkdir(parents=True)
    (xcodeproj / "project.pbxproj").write_text(PBXPROJ)
    return base


def run(tmp_path, project="sites/lesen"):
    result = subprocess.run(["sh", SCRIPT, str(tmp_path), project], capture_output=True, text=True, timeout=120)
    return result.returncode, result.stdout + result.stderr


def write_plist(path, value):
    with open(path, "wb") as fh:
        plistlib.dump(value, fh)


# -- when the rule runs ------------------------------------------------------------------------------------

def test_the_shipped_rule_covers_the_ios_shell_and_its_configuration():
    rules = smoke.load_rules()
    assert smoke.commands_for(["sites/lesen/ios/App/App/Info.plist"], rules) == [COMMAND]
    assert smoke.commands_for(["sites/lesen/capacitor.config.json"], rules) == [COMMAND]
    # The web source is the bundle the shell ships, so it is checked next to the browser rule, not instead of it.
    assert smoke.commands_for(["sites/lesen/static/index.html"], rules) == \
        ["node /opt/harness/smoke/lesen.mjs /work", COMMAND]
    # Other projects and the harness itself are untouched by it.
    assert COMMAND not in smoke.commands_for(["apps/arithmoslayer/project.godot"], rules)
    assert COMMAND not in smoke.commands_for(["tools/harness/smoke.py"], rules)
    assert COMMAND not in smoke.commands_for(["sites/other/ios/App/App/Info.plist"], rules)


def test_a_phase_that_may_touch_the_project_gets_the_rule_and_other_phases_do_not():
    rules = smoke.load_rules()
    assert COMMAND in smoke.commands_for_allowlist(["sites/lesen/"], rules)
    assert COMMAND in smoke.commands_for_allowlist(["sites/lesen/ios/"], rules)
    assert COMMAND not in smoke.commands_for_allowlist(["apps/arithmoslayer/"], rules)
    assert COMMAND not in smoke.commands_for_allowlist(["docs/"], rules)


# -- the positive case -------------------------------------------------------------------------------------

def test_a_complete_offline_shell_passes(tmp_path):
    build(tmp_path)
    code, out = run(tmp_path)
    assert code == 0, out
    assert "OK: iOS shell smoke test passed" in out
    assert "bundles checked: static" in out


def test_a_repository_without_an_ios_shell_is_not_failed_by_the_rule(tmp_path):
    base = build(tmp_path)
    shutil.rmtree(base / "ios")
    code, out = run(tmp_path)
    assert code == 0 and "no iOS shell yet" in out, out
    # A project that is not a Capacitor app at all is skipped outright.
    (tmp_path / "apps/other").mkdir(parents=True)
    code, out = run(tmp_path, "apps/other")
    assert code == 0 and out.startswith("SKIP:"), out


def test_the_real_lesen_web_source_carries_no_network_dependency(tmp_path):
    """The shipped web source is what the iOS app will bundle: nothing in it may load over the network.

    Only the offline class is asserted here. A revision whose `static/` predates a file in the required
    inventory reports that separately, and the whole-shell check below covers a branch that carries one.
    """
    base = build(tmp_path)
    shutil.rmtree(base / "static")
    os.symlink(os.path.join(ROOT, "sites/lesen/static"), base / "static")
    _, out = run(tmp_path)
    offending = [line for line in out.splitlines()
                 if "from the network" in line or "does not exist in the bundle" in line
                 or "remote URL" in line or "may leave the offline app" in line]
    assert offending == [], out


def test_this_repositorys_own_ios_shell_passes_wherever_it_exists():
    """On a branch that carries the generated shell (the run branch), the real artifacts must pass as they are.

    Skipped on a revision that has no iOS shell yet, which is the same answer the rule itself gives there.
    """
    if not os.path.isdir(os.path.join(ROOT, "sites/lesen/ios")):
        pytest.skip("this revision has no iOS shell")
    code, out = run(ROOT)
    assert code == 0, out


# -- the negative cases ------------------------------------------------------------------------------------

def test_a_remote_server_url_fails(tmp_path):
    base = build(tmp_path)
    config = dict(CONFIG, server={"androidScheme": "https", "url": "https://buchstabenzeit.example/app"})
    (base / "capacitor.config.json").write_text(json.dumps(config))
    code, out = run(tmp_path)
    assert code == 1 and "sets server.url" in out, out


@pytest.mark.parametrize("field,value,expected", [
    ("appId", "", "reverse-DNS appId"),
    ("appId", "buchstabenzeit", "reverse-DNS appId"),
    ("webDir", "", "needs a webDir"),
    ("webDir", "../escape", "must be a relative directory"),
])
def test_an_unusable_configuration_fails(tmp_path, field, value, expected):
    base = build(tmp_path)
    (base / "capacitor.config.json").write_text(json.dumps(dict(CONFIG, **{field: value})))
    code, out = run(tmp_path)
    assert code == 1 and expected in out, out


def test_a_missing_runtime_asset_fails(tmp_path):
    base = build(tmp_path)
    os.remove(base / "static/images/logo.png")
    code, out = run(tmp_path)
    assert code == 1 and "images/logo.png" in out and "does not exist in the bundle" in out, out


def test_a_missing_module_the_bundle_imports_fails(tmp_path):
    base = build(tmp_path)
    os.remove(base / "static/storage.mjs")
    code, out = run(tmp_path)
    assert code == 1 and "storage.mjs" in out, out


@pytest.mark.parametrize("artifact", ["ios/App/App/Info.plist", "ios/App/App/PrivacyInfo.xcprivacy",
                                      "ios/App/App.xcodeproj/project.pbxproj"])
def test_a_missing_required_artifact_fails_closed(tmp_path, artifact):
    base = build(tmp_path)
    os.remove(base / artifact)
    code, out = run(tmp_path)
    assert code == 1, out
    assert ("is missing" in out) or ("project.pbxproj" in out), out


@pytest.mark.parametrize("artifact", ["ios/App/App/Info.plist", "ios/App/App/PrivacyInfo.xcprivacy"])
def test_a_malformed_plist_fails(tmp_path, artifact):
    base = build(tmp_path)
    (base / artifact).write_text("<?xml version=\"1.0\"?>\n<plist version=\"1.0\"><dict><key>a</key>\n")
    code, out = run(tmp_path)
    assert code == 1 and "does not parse as a property list" in out, out


def test_a_privacy_manifest_that_is_a_list_fails(tmp_path):
    base = build(tmp_path)
    write_plist(base / "ios/App/App/PrivacyInfo.xcprivacy", [PRIVACY])
    code, out = run(tmp_path)
    assert code == 1 and "must be a dictionary" in out, out


def test_the_shortened_reason_key_apple_ignores_fails(tmp_path):
    """Apple reads NSPrivacyAccessedAPITypeReasons; the shortened spelling is silently ignored."""
    base = build(tmp_path)
    privacy = json.loads(json.dumps(PRIVACY))
    entry = privacy["NSPrivacyAccessedAPITypes"][0]
    entry["NSPrivacyAccessedAPIReasons"] = entry.pop("NSPrivacyAccessedAPITypeReasons")
    write_plist(base / "ios/App/App/PrivacyInfo.xcprivacy", privacy)
    code, out = run(tmp_path)
    assert code == 1 and "NSPrivacyAccessedAPITypeReasons" in out, out


@pytest.mark.parametrize("mutation,expected", [
    ({"NSPrivacyAccessedAPITypes": []}, "must declare NSPrivacyAccessedAPITypes"),
    ({"NSPrivacyAccessedAPITypes": [{"NSPrivacyAccessedAPIType": "NSPrivacyAccessedAPICategoryUserDefaults"}]},
     "needs a non-empty NSPrivacyAccessedAPITypeReasons"),
    ({"NSPrivacyAccessedAPITypes": [{"NSPrivacyAccessedAPIType": "NSPrivacyAccessedAPICategoryUserDefaults",
                                     "NSPrivacyAccessedAPITypeReasons": ["because we want to"]}]},
     "invalid reason code"),
    ({"NSPrivacyAccessedAPITypes": [{"NSPrivacyAccessedAPITypeReasons": ["CA92.1"]}]},
     "missing NSPrivacyAccessedAPIType"),
    ({"NSPrivacyTracking": True}, "NSPrivacyTracking=false"),
    ({"NSPrivacyTrackingDomains": ["analytics.example"]}, "empty NSPrivacyTrackingDomains"),
    ({"NSPrivacyCollectedDataTypes": [{"NSPrivacyCollectedDataType": "NSPrivacyCollectedDataTypeOtherUsageData",
                                       "NSPrivacyCollectedDataTypeTracking": True}]}, "declares tracking"),
])
def test_an_invalid_privacy_manifest_fails(tmp_path, mutation, expected):
    base = build(tmp_path)
    write_plist(base / "ios/App/App/PrivacyInfo.xcprivacy", dict(PRIVACY, **mutation))
    code, out = run(tmp_path)
    assert code == 1 and expected in out, out


def test_a_privacy_manifest_that_is_not_bundled_fails(tmp_path):
    """The file on disk is not evidence; only the Resources build phase ships it."""
    base = build(tmp_path)
    (base / "ios/App/App.xcodeproj/project.pbxproj").write_text(
        PBXPROJ.replace("\t\t\tA1B2C3D41FEDC1A000F3C39B /* PrivacyInfo.xcprivacy in Resources */,\n", ""))
    code, out = run(tmp_path)
    assert code == 1 and "not in the app target's Resources build phase" in out, out


def test_a_bundle_that_is_not_shipped_in_the_binary_fails(tmp_path):
    base = build(tmp_path)
    (base / "ios/App/App.xcodeproj/project.pbxproj").write_text(
        PBXPROJ.replace("\t\t\t50B271D01FEDC1A000F3C39B /* public in Resources */,\n", ""))
    code, out = run(tmp_path)
    assert code == 1 and "would not ship inside the binary" in out, out


@pytest.mark.parametrize("key", ["NSAllowsArbitraryLoads", "NSAllowsArbitraryLoadsInWebContent"])
def test_an_open_transport_security_exception_fails(tmp_path, key):
    base = build(tmp_path)
    write_plist(base / "ios/App/App/Info.plist", dict(INFO, NSAppTransportSecurity={key: True}))
    code, out = run(tmp_path)
    assert code == 1 and key in out, out


@pytest.mark.parametrize("snippet,expected", [
    ("<script src=\"https://cdn.example/analytics.js\"></script>", "from the network"),
    ("<link rel=\"stylesheet\" href=\"//cdn.example/app.css\">", "from the network"),
    ("<img src=\"https://tracker.example/pixel.gif\">", "from the network"),
    ("<style>@font-face { src: url(https://fonts.example/a.woff2); }</style>", "in a stylesheet"),
    ("<a href=\"https://tracker.example/opt-in\">mehr</a>", "only the imprint and the supervisory authority"),
])
def test_a_page_that_depends_on_the_network_fails(tmp_path, snippet, expected):
    base = build(tmp_path)
    (base / "static/index.html").write_text(INDEX.replace("<body>", "<body>" + snippet))
    code, out = run(tmp_path)
    assert code == 1 and expected in out, out


@pytest.mark.parametrize("code_line,expected", [
    ("await fetch('https://api.example/words.json')", "remote URL"),
    ("const base = '//cdn.example/assets'", "protocol-relative"),
    ("import { x } from 'https://cdn.example/x.mjs'", "remote URL"),
    ("importScripts('./not-there.mjs')", "does not exist in the bundle"),
])
def test_bundled_code_that_reaches_the_network_or_a_missing_file_fails(tmp_path, code_line, expected):
    base = build(tmp_path)
    (base / "static/counts-worker.mjs").write_text("import { createStorage } from './storage.mjs'\n" + code_line + "\n")
    code, out = run(tmp_path)
    assert code == 1 and expected in out, out


def test_navigation_allowed_by_the_rule_stays_allowed(tmp_path):
    """The legal links the privacy page must carry are the only remote references that pass."""
    base = build(tmp_path)
    assert run(tmp_path)[0] == 0
    (base / "static/datenschutz.html").write_text(PRIVACY_PAGE.replace(
        "https://derschweigert.de/impressum", "https://evil.example/impressum"))
    assert run(tmp_path)[0] == 1


def test_navigation_to_an_unreviewed_host_in_the_configuration_fails(tmp_path):
    base = build(tmp_path)
    config = dict(CONFIG, server={"androidScheme": "https", "allowNavigation": ["cdn.example"]})
    (base / "capacitor.config.json").write_text(json.dumps(config))
    code, out = run(tmp_path)
    assert code == 1 and "not a reviewed navigation host" in out, out


def test_a_broken_configuration_file_fails_instead_of_crashing(tmp_path):
    base = build(tmp_path)
    (base / "capacitor.config.json").write_text("{ not json")
    code, out = run(tmp_path)
    assert code == 1 and "does not parse as JSON" in out, out


def test_every_failure_prints_one_actionable_line_and_a_count(tmp_path):
    """checks.py keeps only the tail of the output, so the reasons must be at the end."""
    base = build(tmp_path)
    (base / "capacitor.config.json").write_text(json.dumps(dict(CONFIG, appId="nope",
                                                                server={"url": "https://x.example"})))
    code, out = run(tmp_path)
    assert code == 1
    lines = [line for line in out.strip().splitlines() if line.startswith("FAIL: ")]
    assert len(lines) == 3 and lines[-1].endswith("problem(s) in the iOS shell of sites/lesen"), out


@pytest.mark.parametrize("snippet,expected", [
    ("await fetch('https://telemetry.example/beacon')", "remote URL"),
    ("const w = new Worker('https://cdn.example/w.mjs')", "remote URL"),
    ("const base = '//cdn.example/assets'", "protocol-relative"),
    ("import { x } from './not-there.mjs'", "does not exist in the bundle"),
])
def test_inline_script_code_in_a_page_is_checked_like_a_module(tmp_path, snippet, expected):
    """Most of this app's code is inline in index.html; a page is not exempt from the offline rule."""
    base = build(tmp_path)
    (base / "static/index.html").write_text(
        INDEX.replace("import { createStorage } from './storage.mjs'",
                      "import { createStorage } from './storage.mjs'\n" + snippet))
    code, out = run(tmp_path)
    assert code == 1 and expected in out, out


def test_the_legal_links_and_namespace_constants_survive_the_inline_scan(tmp_path):
    base = build(tmp_path)
    (base / "static/index.html").write_text(INDEX.replace(
        "<body>", '<body><svg xmlns="http://www.w3.org/2000/svg"></svg>').replace(
        "import { createStorage } from './storage.mjs'",
        "import { createStorage } from './storage.mjs'\n"
        "const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')"))
    code, out = run(tmp_path)
    assert code == 0, out


def test_a_generated_bundle_does_not_hide_a_broken_source(tmp_path):
    """A stale `public/` copied before the mistake must not vouch for the source it came from."""
    base = build(tmp_path)
    fill_bundle(base / "ios/App/App/public")
    assert run(tmp_path)[0] == 0
    (base / "static/index.html").write_text(INDEX.replace(
        "<body>", "<body><script src=\"https://cdn.example/a.js\"></script>"))
    os.remove(base / "static/words-en.json")
    code, out = run(tmp_path)
    assert code == 1, out
    assert "bundles checked: static, ios/App/App/public" in out
    assert "static/index.html loads" in out and "static is missing the required runtime file words-en.json" in out


def test_a_broken_generated_bundle_is_not_hidden_by_a_clean_source(tmp_path):
    base = build(tmp_path)
    fill_bundle(base / "ios/App/App/public")
    os.remove(base / "ios/App/App/public/words-de.json")
    (base / "www").mkdir()
    fill_bundle(base / "www")
    (base / "www/index.html").write_text(INDEX.replace(
        "<body>", "<body><img src=\"https://tracker.example/pixel.gif\">"))
    code, out = run(tmp_path)
    assert code == 1, out
    assert "ios/App/App/public is missing the required runtime file words-de.json" in out
    assert "www/index.html loads" in out


@pytest.mark.parametrize("missing", ["words-de.json", "sentences/de.json", "fonts/OFL.txt",
                                     "books/README.md", "platform.mjs"])
def test_a_runtime_file_no_reference_scan_can_see_is_still_required(tmp_path, missing):
    """Vocabulary, exercise data, and licence files are loaded by names built at run time."""
    base = build(tmp_path)
    os.remove(base / "static" / missing)
    code, out = run(tmp_path)
    assert code == 1 and "missing the required runtime file %s" % missing in out, out


def test_the_required_inventory_matches_the_product_verifier():
    """The trusted list is a copy of the product's REQUIRED_FILES, not a subset that drifted."""
    script = open(os.path.join(ROOT, "tools/harness/worker/smoke/ios_shell.sh"), encoding="utf-8").read()
    block = script.split("REQUIRED_BUNDLE_FILES = (", 1)[1].split(")", 1)[0]
    trusted = [part.strip().strip('",') for part in block.replace("\n", " ").split() if '"' in part]
    assert sorted(trusted) == sorted(REQUIRED)
    assert len(trusted) == 27


def test_the_trusted_inventory_does_not_drift_from_the_product_verifier():
    """Where the product's verifier exists, the trusted copy must still agree with it.

    The product script is read, never executed: a worker may edit it, so it cannot be an authority.
    """
    verifier = os.path.join(ROOT, "sites/lesen/scripts/verify-bundle.mjs")
    if not os.path.isfile(verifier):
        pytest.skip("this revision has no product bundle verifier")
    source = open(verifier, encoding="utf-8").read()
    block = source.split("REQUIRED_FILES = Object.freeze([", 1)[1].split("]", 1)[0]
    product = [part.strip().strip(",").strip("'\"") for part in block.split("\n") if "'" in part]
    assert sorted(product) == sorted(REQUIRED), "trusted inventory and product verifier disagree"


@pytest.mark.parametrize("value", [None, ["de"], ["en"], ["de", "en", "fr"], ["fr"], "de"])
def test_the_shell_must_declare_german_and_english(tmp_path, value):
    base = build(tmp_path)
    info = dict(INFO)
    if value is None:
        info.pop("CFBundleLocalizations")
    else:
        info["CFBundleLocalizations"] = value
    write_plist(base / "ios/App/App/Info.plist", info)
    code, out = run(tmp_path)
    assert code == 1 and "CFBundleLocalizations" in out, out


def test_declared_german_and_english_pass_in_either_order(tmp_path):
    base = build(tmp_path)
    write_plist(base / "ios/App/App/Info.plist", dict(INFO, CFBundleLocalizations=["en", "de"]))
    assert run(tmp_path)[0] == 0


# -- the escalation entries this rule assumes ----------------------------------------------------------------

@pytest.mark.parametrize("path,expected", [
    ("sites/lesen/ios/App/App/Info.plist", True),
    ("sites/lesen/ios/App/App/PrivacyInfo.xcprivacy", True),
    ("sites/lesen/ios/App/App/App.entitlements", True),
    ("sites/lesen/ios/App/App.xcodeproj/project.pbxproj", True),
    ("sites/lesen/ios/certs/distribution.p12", True),
    ("sites/lesen/ios/profiles/App_Store.mobileprovision", True),
    ("sites/lesen/ios/keys/AuthKey_ABC123.p8", True),
    ("sites/lesen/ios/certs/apple.cer", True),
    # Capacitor rewrites these on `cap sync`, so a worker must be able to touch them.
    ("sites/lesen/ios/App/App/AppDelegate.swift", False),
    ("sites/lesen/ios/App/CapApp-SPM/Package.swift", False),
    ("sites/lesen/ios/App/CapApp-SPM/Package.resolved", False),
    ("sites/lesen/ios/App/App/public/index.html", False),
    ("sites/lesen/static/index.html", False),
])
def test_ios_escalation_matching(path, expected):
    assert broker.is_escalation(path, plans.DEFAULT_POLICY["escalation_paths"]) is expected


def test_the_ios_shell_is_workable_while_its_signing_surface_is_owner_merged():
    """A broad ban on sites/lesen/ios/ would make the plan unexecutable; these entries keep it narrow."""
    result = broker.check_changed_paths(
        ["sites/lesen/ios/App/App/AppDelegate.swift", "sites/lesen/ios/App/App/App.entitlements",
         "sites/lesen/ios/App/App/Info.plist"],
        ["sites/lesen/"], plans.DEFAULT_POLICY["escalation_paths"])
    assert result["escalate"] == ["sites/lesen/ios/App/App/App.entitlements", "sites/lesen/ios/App/App/Info.plist"]
    assert result["rejected"] == [] and result["out_of_scope"] == []
