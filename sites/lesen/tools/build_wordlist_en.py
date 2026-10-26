#!/usr/bin/env python3
"""Build the reviewed reading vocabulary for English (Python 3.9+, standard library only).

Run from any directory: python3 sites/lesen/tools/build_wordlist_en.py
First run downloads pinned, checksum-verified sources into tools/.cache/;
subsequent runs are offline. --cache-dir can point at an existing source cache.

Frequency is not a safety or language classifier. Inclusion requires BOTH a
source rank <= 5,000 and the manually reviewed opt-in vocabulary. Only lowercase
common words are included. The blocklist vetoes even otherwise approved forms.
"""

import argparse
import hashlib
import fnmatch
import json
from pathlib import Path
import random
import re
import urllib.request

TOOLS = Path(__file__).resolve().parent
STATIC = TOOLS.parent / "static"
FREQUENCY_REV = "525f9b560de45753a5ea01069454e72e9aa541c6"
FREQUENCY_URL = (
    "https://raw.githubusercontent.com/hermitdave/FrequencyWords/"
    + FREQUENCY_REV + "/content/2018/en/en_50k.txt"
)
LICENSE_URL = (
    "https://raw.githubusercontent.com/hermitdave/FrequencyWords/"
    + FREQUENCY_REV + "/LICENSE"
)
SOURCES = {
    "frequency.txt": (FREQUENCY_URL,
        "5351ff405b1126ef555791dd4d9798a48e3e9a501a9fc481a9da957752cfb458"),
    "cc-by-4.0.txt": (LICENSE_URL,
        "e08d916cc953f85f7dfa0df530f6d7931f14ce804d053602662d8649b5fac829"),
}
TOP_N = 5_000
LETTERS = re.compile(r"[a-z]{1,8}")

ATTRIBUTION = """Buchstabenzeit: reviewed English reading vocabulary
========================================================

words-en.json and the reviewed vocabulary adaptation are licensed under
Creative Commons Attribution 4.0 International (CC BY 4.0).
https://creativecommons.org/licenses/by/4.0/
Full legal code is reproduced below. Redistribution, including commercial
redistribution, and adaptation are permitted with attribution and an
indication of changes. No endorsement by source authors is implied.

Frequency source:
Hermit Dave, FrequencyWords, English 2018 list, derived from OpenSubtitles2018.
https://github.com/hermitdave/FrequencyWords
Revision: {frequency_rev}
Input: {frequency_url}
License statement (CC BY 4.0 for CONTENT, MIT only for CODE):
https://github.com/hermitdave/FrequencyWords/blob/{frequency_rev}/README.md#license
Original OpenSubtitles corpus: https://opus.nlpl.eu/OpenSubtitles2018.php

Changes by the Buchstabenzeit project, 2026-10-26:
Use only the first 5,000 ranked source tokens; filter to 2-8 lowercase
English letters; require a manually reviewed opt-in vocabulary; remove
names and non-dictionary words; veto blocklisted forms; deduplicate and
sort alphabetically.
This is a deliberately conservative reading vocabulary, not a complete
English dictionary. Common words were manually reviewed. Safety filtering
cannot resolve all possible contextual meanings.

Rebuild (Python 3.9+, standard library; no packages needed):
  python3 sites/lesen/tools/build_wordlist_en.py
Pinned downloads and SHA-256 hashes are in that script. Cached sources live
in sites/lesen/tools/.cache/ (ignored by Git). Subsequent runs work offline.
Review policy is in tools/reviewed-en.txt and tools/blocklist-en.txt.
The JSON, this attribution, and those review inputs are regenerated or kept
alongside the build script; distribute this attribution with the JSON.

--- Full CC BY 4.0 legal code ---

"""


def read_source(cache, name):
    """Read or download a pinned source; never trust a corrupted cache."""
    url, expected = SOURCES[name]
    path = cache / name
    if path.exists():
        data = path.read_bytes()
    else:
        request = urllib.request.Request(url, headers={"User-Agent": "Buchstabenzeit-wordlist/1.0"})
        with urllib.request.urlopen(request, timeout=120) as response:
            data = response.read()
    actual = hashlib.sha256(data).hexdigest()
    if actual != expected:
        raise ValueError("SHA-256 mismatch for " + name + ": " + actual)
    if not path.exists():
        cache.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
    return data.decode("utf-8-sig")


def reviewed_vocabulary(path):
    """Read the reviewed vocabulary file."""
    approved = set()
    for line in path.read_text(encoding="utf-8").splitlines():
        for word in line.partition("#")[0].split():
            if re.fullmatch(r"[a-z]{1,}", word):
                approved.add(word)
            else:
                raise ValueError("Invalid reviewed entry: " + word)
    return approved


def build(cache):
    frequencies = read_source(cache, "frequency.txt")
    legal_code = read_source(cache, "cc-by-4.0.txt")
    approved = reviewed_vocabulary(TOOLS / "reviewed-en.txt")
    patterns = [line.partition("#")[0].strip().lower() for line in
                (TOOLS / "blocklist-en.txt").read_text(encoding="utf-8").splitlines()]
    patterns = [pattern for pattern in patterns if pattern]
    selected = {}
    for line in frequencies.splitlines()[:TOP_N]:
        token = line.split()[0]
        if not LETTERS.fullmatch(token):
            continue
        if token not in approved or any(fnmatch.fnmatchcase(token, p) for p in patterns):
            continue
        selected[token] = token
    words = sorted(selected.values())
    assert len(words) == len({word.lower() for word in words})
    assert all(LETTERS.fullmatch(word) for word in words)
    data = {
        "source": "Hermit Dave FrequencyWords English 2018 (OpenSubtitles), "
                  + FREQUENCY_URL,
        "license": "CC BY 4.0",
        "words": words,
    }
    output = STATIC / "words-en.json"
    output.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    attribution = ATTRIBUTION.format(
        frequency_rev=FREQUENCY_REV, frequency_url=FREQUENCY_URL,
    )
    (STATIC / "words-en-LICENSE.txt").write_text(attribution + legal_code, encoding="utf-8")
    # Read the actual persisted JSON, not only the in-memory build result.
    persisted = json.loads(output.read_text(encoding="utf-8"))
    assert set(persisted) == {"source", "license", "words"}
    assert persisted == data
    print("Words:", len(words), "| bytes:", output.stat().st_size)
    print("Counts:", {length: sum(len(w) == length for w in words) for length in range(2, 9)})
    print("Sample (seed 42):", ", ".join(random.Random(42).sample(words, min(60, len(words)))))
    print("All 2-3 letters:", ", ".join(w for w in words if len(w) <= 3))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache-dir", type=Path, default=TOOLS / ".cache")
    args = parser.parse_args()
    build(args.cache_dir)


if __name__ == "__main__":
    main()
