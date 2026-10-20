#!/usr/bin/env python3
"""Build the reviewed reading vocabulary (Python 3.9+, standard library only).

Run from any directory: python3 sites/lesen/tools/build_wordlist.py
First run downloads pinned, checksum-verified sources into tools/.cache/;
subsequent runs are offline. --cache-dir can point at an existing source cache.

Frequency is not a safety or language classifier. Inclusion requires BOTH a
source rank <= 20,000 and the manually reviewed opt-in vocabulary. Nouns use
Wiktionary lemma/inflection spelling; other forms are explicitly reviewed.
New vocabulary must be reviewed in reviewed-de.txt, not added by increasing a
frequency threshold. The blocklist vetoes even otherwise approved forms.
"""

import argparse
import csv
import fnmatch
import hashlib
import io
import json
from pathlib import Path
import random
import re
import urllib.request

TOOLS = Path(__file__).resolve().parent
STATIC = TOOLS.parent / "static"
FREQUENCY_REV = "525f9b560de45753a5ea01069454e72e9aa541c6"
NOUNS_REV = "da71a2bc519b952b28c9b0b80971cff6efb508f6"
FREQUENCY_URL = (
    "https://raw.githubusercontent.com/hermitdave/FrequencyWords/"
    + FREQUENCY_REV + "/content/2018/de/de_50k.txt"
)
NOUNS_URL = (
    "https://raw.githubusercontent.com/gambolputty/german-nouns/"
    + NOUNS_REV + "/german_nouns/nouns.csv"
)
LICENSE_URL = (
    "https://raw.githubusercontent.com/gambolputty/german-nouns/"
    + NOUNS_REV + "/LICENSE"
)
SOURCES = {
    "frequency.txt": (FREQUENCY_URL,
        "d9e50546fd7e8b6fe6542a2b33c51d1331092b2a3916ec09f80d97856068705b"),
    "nouns.csv": (NOUNS_URL,
        "7b34ca76bb753fa5d3d2b683ecc987824ae874b375ac999a797074fafba2768e"),
    "cc-by-sa-4.0.txt": (LICENSE_URL,
        "da89f9867822be4b8adb1e601d9e9226c195016c6508015eb7593e68ead0c98a"),
}
TOP_N = 20_000
LETTERS = re.compile(r"[A-Za-zÄÖÜäöüß]{2,8}")
NOUN = re.compile(r"[A-ZÄÖÜ][a-zäöüß]{1,7}")
EXCLUDED_POS = {
    "Eigenname", "Vorname", "Nachname", "Toponym", "Abkürzung", "Buchstabe",
    "Affix", "Suffix", "Präfix", "Gebundenes Lexem",
}
# Wiktionary marks the astronomical Sun as an Eigenname; it is nevertheless
# an ordinary, essential reading word. This exception was manually reviewed.
COMMON_NAME_HOMOGRAPHS = {"Sonne"}
CASES = ("nominativ",)
ATTRIBUTION = """Buchstabenzeit: reviewed German reading vocabulary
===================================================

words-de.json and the reviewed vocabulary adaptation are licensed under
Creative Commons Attribution-ShareAlike 4.0 International (CC BY-SA 4.0).
https://creativecommons.org/licenses/by-sa/4.0/
Full legal code is reproduced below. Redistribution, including commercial
redistribution, and adaptation are permitted with attribution, an indication
of changes, and ShareAlike. No endorsement by source authors is implied.

Frequency source:
Hermit Dave, FrequencyWords, German 2018 list, derived from OpenSubtitles2018.
https://github.com/hermitdave/FrequencyWords
Revision: {frequency_rev}
Input: {frequency_url}
License statement (CC BY-SA 4.0 for CONTENT, MIT only for CODE):
https://github.com/hermitdave/FrequencyWords/blob/{frequency_rev}/README.md#license
Original OpenSubtitles corpus: https://opus.nlpl.eu/OpenSubtitles2018.php

Noun spelling and inflection source:
gambolputty and contributors, german-nouns, compiled from German Wiktionary
and its contributors. CC BY-SA 4.0.
https://github.com/gambolputty/german-nouns
https://de.wiktionary.org/
Revision: {nouns_rev}
Input: {nouns_url}
License: {license_url}
Upstream preserves each noun's lemma, grammatical properties and inflections;
this adaptation retains spelling only, with a frequency and safety filter.

Changes by the Buchstabenzeit project, 2026-10-20:
Use only the first 20,000 ranked source tokens; filter to 2-8 German letters;
require a manually reviewed opt-in vocabulary; expand approved nouns only
through attested nominative singular/plural dictionary forms (no archaic
dative forms or misleading genitive homographs); remove names/abbreviations by part of
speech and opt-in review; veto blocklisted forms; prefer explicitly reviewed
lowercase homographs; deduplicate case-insensitively and sort using a
portable German dictionary-order key (DIN 5007-1 style).
This is a deliberately conservative reading vocabulary, not a complete
German dictionary. Short words and approved lemmas/forms were manually
reviewed. Safety filtering cannot resolve all possible contextual meanings.

Rebuild (Python 3.9+, standard library; no packages needed):
  python3 sites/lesen/tools/build_wordlist.py
Pinned downloads and SHA-256 hashes are in that script. Cached sources live
in sites/lesen/tools/.cache/ (ignored by Git). Subsequent runs work offline.
Review policy is in tools/reviewed-de.txt and tools/blocklist-de.txt.
The JSON, this attribution, and those review inputs are regenerated or kept
alongside the build script; distribute this attribution with the JSON.

--- Full CC BY-SA 4.0 legal code ---

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
    nouns, exact = set(), set()
    for line in path.read_text(encoding="utf-8").splitlines():
        for word in line.partition("#")[0].split():
            if re.fullmatch(r"[A-ZÄÖÜ][a-zäöüß]+", word):
                nouns.add(word)
            elif re.fullmatch(r"[a-zäöüß]{2,}", word):
                exact.add(word)
            else:
                raise ValueError("Invalid reviewed entry: " + word)
    return nouns, exact


def noun_forms(text, approved):
    forms, found = {}, set()
    for row in csv.DictReader(io.StringIO(text)):
        if row["lemma"] not in approved:
            continue
        pos = set(row["pos"].split(","))
        if "Substantiv" not in pos or (
            pos & EXCLUDED_POS and row["lemma"] not in COMMON_NAME_HOMOGRAPHS
        ):
            continue
        found.add(row["lemma"])
        for column, word in row.items():
            if column != "lemma" and not column.startswith(CASES):
                continue
            if NOUN.fullmatch(word):
                forms[word.lower()] = word
    missing = approved - found
    if missing:
        raise ValueError("Unverified noun lemmas: " + ", ".join(sorted(missing)))
    return forms


def german_key(word):
    """Portable dictionary order: umlauts at their base letters, ß at ss."""
    lower = word.lower()
    primary = lower.translate(str.maketrans({"ä": "a", "ö": "o", "ü": "u", "ß": "ss"}))
    return primary, lower


def build(cache):
    frequencies = read_source(cache, "frequency.txt")
    lexicon = read_source(cache, "nouns.csv")
    legal_code = read_source(cache, "cc-by-sa-4.0.txt")
    approved_nouns, exact = reviewed_vocabulary(TOOLS / "reviewed-de.txt")
    spellings = noun_forms(lexicon, approved_nouns)
    # Lowercase overrides are reviewed homographs (e.g. essen, morgen, laut).
    spellings.update({word: word for word in exact})
    patterns = [line.partition("#")[0].strip().lower() for line in
                (TOOLS / "blocklist-de.txt").read_text(encoding="utf-8").splitlines()]
    patterns = [pattern for pattern in patterns if pattern]
    selected = {}
    for line in frequencies.splitlines()[:TOP_N]:
        token = line.split()[0]
        if not LETTERS.fullmatch(token) or token.isupper():
            continue
        key = token.lower()
        if key not in spellings or any(fnmatch.fnmatchcase(key, p) for p in patterns):
            continue
        selected[key] = spellings[key]
    words = sorted(selected.values(), key=german_key)
    assert len(words) == len({word.lower() for word in words})
    assert all(LETTERS.fullmatch(word) for word in words)
    assert all(word == word.lower() or NOUN.fullmatch(word) for word in words)
    assert {"Mama", "Oma", "Sofa"} <= set(words)
    data = {
        "source": "Hermit Dave FrequencyWords German 2018 (OpenSubtitles), "
                  + FREQUENCY_URL + "; noun spelling: gambolputty/german-nouns "
                  "(German Wiktionary), " + NOUNS_URL,
        "license": "CC BY-SA 4.0",
        "words": words,
    }
    output = STATIC / "words-de.json"
    output.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    attribution = ATTRIBUTION.format(
        frequency_rev=FREQUENCY_REV, frequency_url=FREQUENCY_URL,
        nouns_rev=NOUNS_REV, nouns_url=NOUNS_URL, license_url=LICENSE_URL,
    )
    (STATIC / "words-de-LICENSE.txt").write_text(attribution + legal_code, encoding="utf-8")
    # Read the actual persisted JSON, not only the in-memory build result.
    persisted = json.loads(output.read_text(encoding="utf-8"))
    assert set(persisted) == {"source", "license", "words"}
    assert persisted == data
    print("Words:", len(words), "| bytes:", output.stat().st_size)
    print("Counts:", {length: sum(len(w) == length for w in words) for length in range(2, 9)})
    print("Sample (seed 42):", ", ".join(random.Random(42).sample(words, min(60, len(words)))))
    print("All 2-3 letters:", ", ".join(w for w in words if len(w) <= 3))
    letters = set("maostne")
    for limit in (4, 6):
        matches = [w for w in words if len(w) <= limit and set(w.lower()) <= letters]
        print("maostne, max", limit, "(", len(matches), "):", ", ".join(matches))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache-dir", type=Path, default=TOOLS / ".cache")
    args = parser.parse_args()
    build(args.cache_dir)


if __name__ == "__main__":
    main()
