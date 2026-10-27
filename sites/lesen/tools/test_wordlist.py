"""Offline regression checks: python3 -m unittest discover -s sites/lesen/tools."""

import csv
import fnmatch
import importlib.util
import io
import json
from pathlib import Path
import re
import unittest

TOOLS = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location("build_wordlist", TOOLS / "build_wordlist.py")
BUILDER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(BUILDER)
ENGLISH_ORIGIN_WORDS = frozenset("""
    team teams job jobs party partys chef chefs handy handys keks app computer
    show shows hobby hobbys event trend start test tests top fan fans hit hits
    set song songs okay super fair jazz jeans jet jets jeep joker software
    shampoo shorts shrimp shrimps shuttle snack snacks design designer cookie
    cover crew crews cracker cupcake cupcakes club clubs clique clown clowns
    coach cockpit code codes cola college comic comics burger
""".split())


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

    def test_english_origin_words_are_excluded(self):
        normalized_words = {word.casefold() for word in self.words}
        reviewed = {word.casefold() for line in (TOOLS / "reviewed-de.txt").read_text(encoding="utf-8").splitlines()
                    if not line.lstrip().startswith("#") for word in line.split()}
        patterns = {line.partition("#")[0].strip().casefold() for line in
                    (TOOLS / "blocklist-de.txt").read_text(encoding="utf-8").splitlines()}

        self.assertFalse(ENGLISH_ORIGIN_WORDS & normalized_words)
        self.assertFalse(ENGLISH_ORIGIN_WORDS & reviewed)
        self.assertTrue(ENGLISH_ORIGIN_WORDS <= patterns)

    def test_safety_veto(self):
        patterns = [line.partition("#")[0].strip().lower() for line in
                    (TOOLS / "blocklist-de.txt").read_text(encoding="utf-8").splitlines()]
        veto = re.compile("|".join(fnmatch.translate(pattern) for pattern in patterns if pattern))
        self.assertFalse([word for word in self.words if veto.match(word.lower())])

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
