import os

# Test-only value; the real PIN comes from the DERSCHWEIGERT_ADMIN_PIN secret.
os.environ.setdefault("ADMIN_PIN", "test-pin-000000")
