"""conftest.py caps the bcrypt cost for speed, so no test that hashes a password can notice the production cost being
lowered. These tests read the source instead."""
import pathlib
import re

import bcrypt

APP = pathlib.Path(__file__).resolve().parents[1] / "app"
PRODUCTION_ROUNDS = 12


def test_every_password_hash_in_the_app_asks_for_the_production_cost():
    calls = []
    for path in sorted(APP.glob("*.py")):
        calls += [(path.name, args) for args in re.findall(r"bcrypt\.gensalt\(([^)]*)\)", path.read_text())]
    assert calls, "no bcrypt.gensalt call found; the pattern no longer matches how the app hashes passwords"
    wrong = [(name, args) for name, args in calls if args.replace(" ", "") != "rounds=%d" % PRODUCTION_ROUNDS]
    assert not wrong, "password hashes must use rounds=%d: %s" % (PRODUCTION_ROUNDS, wrong)


def test_the_suite_hashes_at_the_capped_cost():
    """If the cap stops applying, the suite silently doubles its runtime; this makes that visible."""
    assert bcrypt.gensalt(rounds=PRODUCTION_ROUNDS).startswith(b"$2b$04$")
