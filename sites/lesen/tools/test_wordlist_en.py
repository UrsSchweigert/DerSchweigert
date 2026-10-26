"""Offline regression checks: python3 -m unittest discover -s sites/lesen/tools."""

import fnmatch
import importlib.util
import json
from pathlib import Path
import unittest

TOOLS = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location("build_wordlist_en", TOOLS / "build_wordlist_en.py")
BUILDER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(BUILDER)


class WordlistTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data = json.loads((TOOLS.parent / "static/words-en.json").read_text(encoding="utf-8"))
        cls.words = cls.data["words"]

    def test_shape_and_size(self):
        self.assertEqual(set(self.data), {"source", "license", "words"})
        self.assertEqual(self.data["license"], "CC BY 4.0")
        self.assertGreater(len(self.words), 10)
        self.assertLess((TOOLS.parent / "static/words-en.json").stat().st_size, 100_000)

    def test_spelling_order_and_uniqueness(self):
        self.assertTrue(all(BUILDER.LETTERS.fullmatch(w) for w in self.words))
        self.assertFalse(any(w.isupper() for w in self.words))
        self.assertEqual(len(self.words), len({w.lower() for w in self.words}))
        self.assertEqual(self.words, sorted(self.words))

    def test_regression_examples(self):
        self.assertTrue({"a", "and", "the", "you"} <= set(self.words))

    def test_safety_veto(self):
        patterns = [line.partition("#")[0].strip().lower() for line in
                    (TOOLS / "blocklist-en.txt").read_text(encoding="utf-8").splitlines()]
        self.assertFalse([w for w in self.words if any(
            p and fnmatch.fnmatchcase(w.lower(), p) for p in patterns)])


if __name__ == "__main__":
    unittest.main()
