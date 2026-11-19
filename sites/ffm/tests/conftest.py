"""Shared setup for the ffm suite.

The application hashes passwords with bcrypt at cost 12, which takes about a quarter of a second per hash. Hundreds of
tests register or log in a user, and at production cost that hashing was half of the suite's runtime (211 s of which
about 100 s was bcrypt). The cost factor only sets how long a hash takes; it changes nothing about what the tests
assert. So the suite caps it at bcrypt's minimum, and test_password_hash_cost.py pins the production value in the
source instead, where no patch can hide a change to it.
"""
import bcrypt

TEST_ROUNDS = 4  # bcrypt's minimum
_real_gensalt = bcrypt.gensalt


def _cheap_gensalt(rounds: int = 12, prefix: bytes = b"2b") -> bytes:
    return _real_gensalt(rounds=min(rounds, TEST_ROUNDS), prefix=prefix)


# Patched at import, not in a fixture: the application reads `bcrypt.gensalt` at call time, and module-level test setup
# that hashes a password runs before any fixture would.
bcrypt.gensalt = _cheap_gensalt
