#!/bin/sh
# Trusted smoke test for the Capacitor iOS shell. Baked into the worker image; workers cannot change it.
# Usage: sh /opt/harness/smoke/ios_shell.sh <repository root> <project dir>
#
# It checks the *shape* of the app a reviewer would reject: a webview pointed at a remote server,
# a privacy manifest that is missing, malformed, or not actually bundled, tracking, and a web bundle
# that loads anything over the network or references a file that is not there. It never builds, never
# signs, and never reaches the network: Python standard library only.
set -eu

root="${1:-/work}"
project="${2:-}"
if [ -z "$project" ]; then
    echo "FAIL: ios_shell.sh needs a project directory (for example sites/lesen)" >&2
    exit 2
fi

exec python3 - "$root" "$project" <<'PY'
import json
import os
import plistlib
import re
import sys
from html.parser import HTMLParser
from urllib.parse import urlsplit

root, project = sys.argv[1], sys.argv[2]
base = os.path.join(root, project)

# Hosts a *link* may send the user to: the first-party site (imprint) and the supervisory authority the
# privacy policy must name. Everything else is refused. No remote host is allowed in a loading position
# at any time, so this list can never turn into a way to load code or data from the network.
NAVIGATION_HOSTS = {"derschweigert.de", "www.derschweigert.de", "lda.bayern.de", "www.lda.bayern.de"}
# XML namespace identifiers (createElementNS, xmlns) are constants, not downloads.
NAMESPACE_PREFIXES = ("http://www.w3.org/",)
# URL schemes that stay inside the app or open a handler, so they are neither a file nor a network load.
LOCAL_SCHEMES = {"data", "mailto", "tel", "sms", "javascript", "blob", "about", "capacitor", "ionic", "file"}
SCAN_TEXT = (".html", ".htm", ".js", ".mjs", ".css")
# Every file the app needs at run time, including data the code loads by a name it builds at run time
# (vocabulary, sentences, licences), which no reference scan can see. This list is the trusted copy of
# sites/lesen/scripts/verify-bundle.mjs REQUIRED_FILES: the product script is a worker-editable
# convenience, so its inventory is mirrored here and never executed from here.
REQUIRED_BUNDLE_FILES = (
    "index.html", "favicon.png", "apple-touch-icon.png",
    "platform.mjs", "storage.mjs", "sounds.mjs", "scoring.mjs", "coverage.mjs", "i18n.mjs",
    "speech-adapter.js", "speech-offline-filter.mjs", "counts-compute.mjs", "counts-worker.mjs",
    "sentences/cards.mjs", "sentences/de.json", "sentences/en.json",
    "words-de.json", "words-en.json", "words-de-LICENSE.txt", "words-en-LICENSE.txt",
    "fonts/OFL.txt", "fonts/andika-latin-regular.woff2", "fonts/andika-latin-bold.woff2",
    "images/buchstabenzeit-logo.png", "datenschutz.html", "datenschutz-en.html", "books/README.md",
)
# The app ships German and English; the shell must declare exactly those, or the App Store lists it wrong.
REQUIRED_LOCALIZATIONS = ["de", "en"]
REASON_CODE = re.compile(r"^[A-Za-z0-9.]+$")
APP_ID = re.compile(r"^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_-]*)+$")
SCHEME = re.compile(r"(?i)^([a-z][a-z0-9+.-]*):")
# Module specifiers are never built by concatenation, so requiring the file to exist is safe here.
SPECIFIER = re.compile(r"""(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\bnew\s+Worker\s*\(\s*|\bimportScripts\s*\(\s*)(['"])([^'"\n]+)\1""")
REMOTE_IN_CODE = re.compile(r"""(?i)https?://[^\s'")>]+""")
PROTOCOL_RELATIVE = re.compile(r"""(['"])//[A-Za-z0-9.-]+\.[A-Za-z]{2,}""")
CSS_URL = re.compile(r"""(?i)url\(\s*(['"]?)([^'")]+)\1\s*\)""")

problems = []
notes = []


def fail(message):
    problems.append(message)


def note(message):
    notes.append(message)


def classify(url):
    text = (url or "").strip()
    if not text:
        return "empty"
    if text.startswith("//"):
        return "remote"
    match = SCHEME.match(text)
    if match:
        return "app" if match.group(1).lower() in LOCAL_SCHEMES else "remote"
    return "local"


def local_path(url):
    """The file a local reference points at, or None for a pure fragment."""
    cut = (url or "").split("#", 1)[0].split("?", 1)[0].strip()
    return cut or None


def read_plist(path, label):
    try:
        with open(path, "rb") as fh:
            value = plistlib.load(fh)
    except FileNotFoundError:
        fail("%s is missing; the iOS shell is incomplete" % label)
        return None
    except Exception as exc:  # malformed plist: plistlib raises several types
        fail("%s does not parse as a property list: %s" % (label, exc))
        return None
    if not isinstance(value, dict):
        fail("%s must be a dictionary at the top level" % label)
        return None
    return value


# -- 1. Capacitor configuration -------------------------------------------------------------------------

config_path = os.path.join(base, "capacitor.config.json")
ios_dir = os.path.join(base, "ios")
has_ios = os.path.isdir(ios_dir)
if not os.path.exists(config_path):
    if has_ios:
        fail("%s/capacitor.config.json is missing, but an iOS shell exists" % project)
        config = {}
    else:
        print("SKIP: %s has no Capacitor configuration and no iOS shell" % project)
        raise SystemExit(0)
else:
    try:
        with open(config_path, encoding="utf-8") as fh:
            config = json.load(fh)
    except Exception as exc:
        fail("capacitor.config.json does not parse as JSON: %s" % exc)
        config = {}
    if not isinstance(config, dict):
        fail("capacitor.config.json must be a JSON object")
        config = {}

app_id = config.get("appId")
if not isinstance(app_id, str) or not APP_ID.match(app_id or ""):
    fail("capacitor.config.json needs a reverse-DNS appId, found %r" % (app_id,))
web_dir = config.get("webDir")
if not isinstance(web_dir, str) or not web_dir.strip():
    fail("capacitor.config.json needs a webDir naming the bundled web assets, found %r" % (web_dir,))
    web_dir = ""
elif web_dir.startswith("/") or ".." in web_dir.split("/"):
    fail("capacitor.config.json webDir %r must be a relative directory inside the project" % web_dir)
    web_dir = ""

server = config.get("server") or {}
if not isinstance(server, dict):
    fail("capacitor.config.json server must be an object")
    server = {}
if server.get("url"):
    fail("capacitor.config.json sets server.url=%r: the app would load from the network instead of its "
         "bundle, which is the App Store rejection this check exists to prevent" % server["url"])
if server.get("cleartext"):
    fail("capacitor.config.json sets server.cleartext: the shell must not allow plain HTTP")
for entry in server.get("allowNavigation") or []:
    host = str(entry).strip().lower().lstrip("*.")
    if host and host not in NAVIGATION_HOSTS:
        fail("capacitor.config.json allows navigation to %r, which is not a reviewed navigation host" % entry)

if not has_ios:
    for message in problems:
        print("FAIL: " + message)
    if problems:
        print("FAIL: %d problem(s) in %s" % (len(problems), project))
        raise SystemExit(1)
    print("OK: %s has no iOS shell yet; its Capacitor configuration is offline-safe" % project)
    raise SystemExit(0)

# -- 2. iOS artifacts, all required once an iOS shell exists --------------------------------------------

info = read_plist(os.path.join(base, "ios/App/App/Info.plist"), "ios/App/App/Info.plist")
if info is not None:
    for key in ("CFBundleIdentifier", "CFBundleVersion", "CFBundleShortVersionString"):
        if not str(info.get(key, "")).strip():
            fail("ios/App/App/Info.plist is missing %s" % key)
    localizations = info.get("CFBundleLocalizations")
    if not isinstance(localizations, list) or sorted(str(x) for x in localizations) != REQUIRED_LOCALIZATIONS:
        fail("ios/App/App/Info.plist must declare CFBundleLocalizations %s; found %r"
             % (REQUIRED_LOCALIZATIONS, localizations))
    ats = info.get("NSAppTransportSecurity") or {}
    if isinstance(ats, dict):
        for key in ("NSAllowsArbitraryLoads", "NSAllowsArbitraryLoadsInWebContent", "NSAllowsLocalNetworking"):
            if ats.get(key) is True:
                fail("ios/App/App/Info.plist sets NSAppTransportSecurity.%s, which opens the shell to "
                     "plain network loads" % key)

privacy_rel = "ios/App/App/PrivacyInfo.xcprivacy"
privacy = read_plist(os.path.join(base, privacy_rel), privacy_rel)
if privacy is not None:
    if privacy.get("NSPrivacyTracking") is not False:
        fail("%s must declare NSPrivacyTracking=false; found %r" % (privacy_rel, privacy.get("NSPrivacyTracking")))
    domains = privacy.get("NSPrivacyTrackingDomains")
    if not isinstance(domains, list) or domains:
        fail("%s must declare an empty NSPrivacyTrackingDomains; found %r" % (privacy_rel, domains))
    collected = privacy.get("NSPrivacyCollectedDataTypes")
    if not isinstance(collected, list):
        fail("%s must declare NSPrivacyCollectedDataTypes (an empty array if nothing is collected)" % privacy_rel)
    else:
        for entry in collected:
            if isinstance(entry, dict) and entry.get("NSPrivacyCollectedDataTypeTracking") is True:
                fail("%s declares tracking in NSPrivacyCollectedDataTypes, which this app must not do" % privacy_rel)
    accessed = privacy.get("NSPrivacyAccessedAPITypes")
    if not isinstance(accessed, list) or not accessed:
        fail("%s must declare NSPrivacyAccessedAPITypes with one entry per required-reason API" % privacy_rel)
    else:
        for index, entry in enumerate(accessed):
            where = "%s NSPrivacyAccessedAPITypes[%d]" % (privacy_rel, index)
            if not isinstance(entry, dict):
                fail("%s must be a dictionary" % where)
                continue
            api = entry.get("NSPrivacyAccessedAPIType")
            if not isinstance(api, str) or not api.strip():
                fail("%s is missing NSPrivacyAccessedAPIType" % where)
            if "NSPrivacyAccessedAPIReasons" in entry and "NSPrivacyAccessedAPITypeReasons" not in entry:
                fail("%s uses NSPrivacyAccessedAPIReasons; Apple reads NSPrivacyAccessedAPITypeReasons, so the "
                     "declared reason would be ignored" % where)
                continue
            reasons = entry.get("NSPrivacyAccessedAPITypeReasons")
            if not isinstance(reasons, list) or not reasons:
                fail("%s needs a non-empty NSPrivacyAccessedAPITypeReasons array" % where)
                continue
            for reason in reasons:
                if not isinstance(reason, str) or not REASON_CODE.match(reason or ""):
                    fail("%s has an invalid reason code %r" % (where, reason))

# The manifest only reaches the App Store if the app target bundles it, so read the project file too.
projects = []
ios_app = os.path.join(base, "ios")
for dirpath, dirnames, filenames in os.walk(ios_app):
    if "project.pbxproj" in filenames and dirpath.endswith(".xcodeproj"):
        projects.append(os.path.join(dirpath, "project.pbxproj"))
    dirnames[:] = [d for d in dirnames if d not in ("Pods", "build", "DerivedData", ".build")]
if not projects:
    fail("no <App>.xcodeproj/project.pbxproj under %s/ios: the shell cannot be built or reviewed" % project)
else:
    resources = ""
    for path in sorted(projects):
        try:
            text = open(path, encoding="utf-8", errors="replace").read()
        except OSError as exc:
            fail("cannot read %s: %s" % (os.path.relpath(path, base), exc))
            continue
        for match in re.finditer(r"/\* Begin PBXResourcesBuildPhase section \*/(.*?)"
                                 r"/\* End PBXResourcesBuildPhase section \*/", text, re.S):
            resources += match.group(1)
    if not resources.strip():
        fail("the Xcode project has no PBXResourcesBuildPhase, so nothing would be bundled")
    else:
        if "PrivacyInfo.xcprivacy" not in resources:
            fail("PrivacyInfo.xcprivacy is not in the app target's Resources build phase, so the built app "
                 "would ship without a privacy manifest")
        assets = [name for name in ("public", os.path.basename(web_dir.rstrip("/")) if web_dir else "") if name]
        if not any(name in resources for name in assets):
            fail("the Resources build phase bundles none of %s, so the web app would not ship inside the "
                 "binary" % " or ".join(repr(a) for a in assets))

# -- 3. The offline bundle -------------------------------------------------------------------------------

# Every bundle that exists is checked: the source of truth and each generated copy. Checking only the
# first would let a stale generated bundle hide a broken source, or a clean source hide a stale copy.
bundles = [("static", os.path.join(base, "static"))]
if web_dir:
    bundles.append((web_dir, os.path.join(base, web_dir)))
bundles.append(("ios/App/App/public", os.path.join(base, "ios/App/App/public")))
present = [(name, path) for name, path in bundles if os.path.isdir(path)]
if not os.path.isdir(os.path.join(base, "static")):
    fail("%s/static is missing: the copy step that produces the bundle has no source" % project)
if not present:
    fail("no web bundle to check: none of %s exists" % ", ".join(name for name, _ in bundles))
else:
    note("bundles checked: %s" % ", ".join(name for name, _ in present))

copy_step = os.path.join(base, "scripts/copy-assets.mjs")
if web_dir and os.path.isfile(copy_step):
    produced = open(copy_step, encoding="utf-8", errors="replace").read()
    if ("'%s'" % web_dir) not in produced and ('"%s"' % web_dir) not in produced:
        fail("scripts/copy-assets.mjs does not produce the configured webDir %r" % web_dir)


class References(HTMLParser):
    """Separates what the page *loads* from where it merely *links*, and keeps inline script code."""

    def __init__(self):
        HTMLParser.__init__(self, convert_charrefs=True)
        self.loads = []    # (tag, attribute, value)
        self.links = []    # anchor targets
        self.styles = []
        self.scripts = []  # inline <script> bodies
        self._style = False
        self._script = False

    def handle_starttag(self, tag, attrs):
        if tag == "style":
            self._style = True
        if tag == "script" and not any(a == "src" for a, _ in attrs):
            self._script = True
        for attr, value in attrs:
            if not value or not value.strip():
                continue
            value = value.strip()
            if tag == "a" and attr == "href":
                self.links.append(value)
            elif attr in ("src", "poster", "data") or (attr.endswith(":href") and tag == "use"):
                self.loads.append((tag, attr, value))
            elif attr == "href" and tag in ("link", "use"):
                self.loads.append((tag, attr, value))
            elif attr == "srcset":
                for part in value.split(","):
                    first = part.strip().split(" ")[0]
                    if first:
                        self.loads.append((tag, attr, first))
            elif attr == "style":
                self.styles.append(value)

    def handle_endtag(self, tag):
        if tag == "style":
            self._style = False
        if tag == "script":
            self._script = False

    def handle_data(self, data):
        if self._style:
            self.styles.append(data)
        if self._script:
            self.scripts.append(data)


def check_local(bundle, reference, source_file, where):
    target = local_path(reference)
    if target is None:
        return
    if target.startswith("/"):
        resolved = os.path.join(bundle, target.lstrip("/"))
    else:
        resolved = os.path.join(os.path.dirname(source_file), target)
    if not os.path.exists(resolved):
        fail("%s references %r, which does not exist in the bundle" % (where, reference))


def check_code(bundle, code, path, where):
    """Script code, whether it came from a .mjs file or from an inline <script> in a page."""
    for url in REMOTE_IN_CODE.findall(code):
        if not url.startswith(NAMESPACE_PREFIXES):
            fail("%s contains the remote URL %r; bundled code must not reach the network" % (where, url))
    if PROTOCOL_RELATIVE.search(code):
        fail("%s contains a protocol-relative URL; bundled code must not reach the network" % where)
    for _, spec in SPECIFIER.findall(code):
        kind = classify(spec)
        if kind == "remote":
            fail("%s imports %r over the network" % (where, spec))
        elif kind == "local":
            check_local(bundle, spec, path, where)


def scan_bundle(label, bundle):
    if not os.path.isfile(os.path.join(bundle, "index.html")):
        fail("%s/index.html is missing: the shell would open an empty webview" % label)
    # Data the app loads by a name it builds at run time is invisible to a reference scan, so the
    # inventory is checked directly. A bundle that is missing one of these fails before a device finds out.
    for required in REQUIRED_BUNDLE_FILES:
        if not os.path.isfile(os.path.join(bundle, required)):
            fail("%s is missing the required runtime file %s" % (label, required))

    for dirpath, dirnames, filenames in os.walk(bundle):
        dirnames[:] = [d for d in sorted(dirnames) if d not in ("node_modules", ".git")]
        for name in sorted(filenames):
            if not name.lower().endswith(SCAN_TEXT):
                continue
            path = os.path.join(dirpath, name)
            rel = "%s/%s" % (label, os.path.relpath(path, bundle).replace(os.sep, "/"))
            try:
                text = open(path, encoding="utf-8", errors="replace").read()
            except OSError as exc:
                fail("cannot read %s: %s" % (rel, exc))
                continue

            styles = [text] if name.lower().endswith(".css") else []
            if name.lower().endswith((".html", ".htm")):
                parser = References()
                try:
                    parser.feed(text)
                    parser.close()
                except Exception as exc:
                    fail("%s does not parse as HTML: %s" % (rel, exc))
                    continue
                styles.extend(parser.styles)
                for tag, attr, value in parser.loads:
                    kind = classify(value)
                    if kind == "remote":
                        fail("%s loads <%s %s=%r> from the network; the app must run from its bundle"
                             % (rel, tag, attr, value))
                    elif kind == "local":
                        check_local(bundle, value, path, rel)
                for value in parser.links:
                    kind = classify(value)
                    if kind == "remote":
                        host = (urlsplit(value if "//" in value[:8] else "//" + value).hostname or "").lower()
                        if host not in NAVIGATION_HOSTS:
                            fail("%s links to %r; only the imprint and the supervisory authority may leave "
                                 "the offline app" % (rel, value))
                    elif kind == "local":
                        check_local(bundle, value, path, rel)
                # Inline scripts are code, and most of this app's code is inline in index.html.
                for script in parser.scripts:
                    check_code(bundle, script, path, rel)
                # Also read the raw page, so a module specifier survives a page the parser mangles.
                for _, spec in SPECIFIER.findall(text):
                    kind = classify(spec)
                    if kind == "remote":
                        fail("%s imports %r over the network" % (rel, spec))
                    elif kind == "local":
                        check_local(bundle, spec, path, rel)

            for block in styles:
                for _, value in CSS_URL.findall(block):
                    kind = classify(value)
                    if kind == "remote":
                        fail("%s loads %r from the network in a stylesheet" % (rel, value))
                    elif kind == "local":
                        check_local(bundle, value, path, rel)

            if name.lower().endswith((".js", ".mjs")):
                check_code(bundle, text, path, rel)


for label, path in present:
    scan_bundle(label, path)

# -- 4. Verdict ------------------------------------------------------------------------------------------

for message in notes:
    print("note: " + message)
seen, ordered = set(), []
for message in problems:
    if message not in seen:
        seen.add(message)
        ordered.append(message)
for message in ordered:
    print("FAIL: " + message)
if ordered:
    print("FAIL: %d problem(s) in the iOS shell of %s" % (len(ordered), project))
    raise SystemExit(1)
print("OK: iOS shell smoke test passed for %s" % project)
PY
