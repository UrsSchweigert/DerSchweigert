"""Offline regression checks: python3 -m unittest discover -s sites/lesen/tools."""

import csv
import fnmatch
import importlib.util
import io
import json
from pathlib import Path
import unittest

TOOLS = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location("build_wordlist", TOOLS / "build_wordlist.py")
BUILDER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(BUILDER)


class WordlistTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data = json.loads((TOOLS.parent / "static/words-de.json").read_text(encoding="utf-8"))
        cls.words = cls.data["words"]

    def test_shape_and_size(self):
        self.assertEqual(set(self.data), {"source", "license", "words"})
        self.assertEqual(self.data["license"], "CC BY-SA 4.0")
        self.assertGreater(len(self.words), 3000)
        self.assertLess((TOOLS.parent / "static/words-de.json").stat().st_size, 200_000)

    def test_spelling_order_and_uniqueness(self):
        self.assertTrue(all(BUILDER.LETTERS.fullmatch(w) for w in self.words))
        self.assertFalse(any(w.isupper() for w in self.words))
        self.assertEqual(len(self.words), len({w.lower() for w in self.words}))
        self.assertEqual(self.words, sorted(self.words, key=BUILDER.german_key))
        self.assertEqual(sorted(["Zoo", "Öl", "Ohr"], key=BUILDER.german_key), ["Ohr", "Öl", "Zoo"])

    def test_regression_examples(self):
        self.assertTrue({"Mama", "Oma", "Sofa", "Äpfel", "Bäume", "Mädchen", "Schwein",
                         "essen", "morgen", "brauchen", "probiere"} <= set(self.words))
        self.assertFalse({"mama", "oma", "sofa", "Essen", "Morgen", "Beginnen", "Buchen",
                          "laß", "daß", "muß", "Jasmine", "Butters", "Wales", "Vögeln",
                          "vögeln", "köpfen", "schossen", "Tablette", "Hitler", "Nazi",
                          "Sex", "Mord", "Koks", "Scheiße", "Fuck", "John", "Mike"}
                         & set(self.words))

    def test_safety_veto(self):
        patterns = [line.partition("#")[0].strip().lower() for line in
                    (TOOLS / "blocklist-de.txt").read_text(encoding="utf-8").splitlines()]
        self.assertFalse([w for w in self.words if any(
            p and fnmatch.fnmatchcase(w.lower(), p) for p in patterns)])

    def test_letter_selection(self):
        letters = set("maostne")
        matches = lambda limit: [w for w in self.words if len(w) <= limit and set(w.lower()) <= letters]
        self.assertGreaterEqual(len(matches(4)), 25)
        self.assertGreaterEqual(len(matches(6)), 60)
        self.assertTrue({"Mama", "Oma", "Name", "Nase"} <= set(matches(4)))
        self.assertTrue({"Tomate", "Tasse", "Sonne"} <= set(matches(6)))

    def test_noun_lexicon_excludes_names_and_old_datives(self):
        buffer = io.StringIO()
        writer = csv.writer(buffer)
        writer.writerow(["lemma", "pos", "nominativ singular", "nominativ plural", "dativ singular"])
        writer.writerow(["Hund", "Substantiv", "Hund", "Hunde", "Hunde"])
        writer.writerow(["Otto", "Eigenname,Substantiv", "Otto", "Ottos", "Otto"])
        self.assertEqual(BUILDER.noun_forms(buffer.getvalue(), {"Hund"}), {"hund": "Hund", "hunde": "Hunde"})
        with self.assertRaisesRegex(ValueError, "Unverified noun lemmas"):
            BUILDER.noun_forms(buffer.getvalue(), {"Otto"})


if __name__ == "__main__":
    unittest.main()
