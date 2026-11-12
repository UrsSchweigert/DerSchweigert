"""Shared request-payload validation helpers."""

MAX_EMAIL_LEN = 254


def is_valid_email(value, max_len=MAX_EMAIL_LEN):
    """Structural email check only: a non-empty string, no whitespace or
    control characters anywhere, and exactly one '@' with a non-empty local
    part and a non-empty domain part either side of it.

    Deliberately never verifies deliverability or account existence — the
    public forms that use this must not become an address oracle. Rejects
    non-strings outright instead of coercing with str(), so a malformed JSON
    value can never be stored as a misleading stringified object.
    """
    if not isinstance(value, str) or not 3 <= len(value) <= max_len:
        return False
    if any(ch.isspace() or ord(ch) < 0x20 or ord(ch) == 0x7f for ch in value):
        return False
    if value.count('@') != 1:
        return False
    local, domain = value.split('@')
    return bool(local) and bool(domain)


GOOGLE_MAIL_DOMAINS = ('gmail.com', 'googlemail.com')


def is_google_mail_address(value):
    """True when `value` is a valid address on Gmail or Googlemail.

    Google Play's test track only invites Google accounts, and these two
    domains are the only ones that are guaranteed to be one. A Google
    Workspace address is also a Google account but is indistinguishable from
    any other custom domain by syntax, so it is deliberately not accepted —
    the beta page tells such testers to write to support instead of silently
    collecting an address that Google will never invite.
    """
    if not is_valid_email(value):
        return False
    return value.rsplit('@', 1)[1].lower() in GOOGLE_MAIL_DOMAINS


def is_valid_int(value, min_value=None, max_value=None):
    """Strict integer range check.

    Deliberately uses `type(value) is int` rather than `isinstance(value,
    int)`: since `bool` is a subclass of `int` in Python, `isinstance`
    would silently accept `True`/`False` as valid scores/levels/years
    (e.g. `{"score": true}` would pass as `score=1`). Every numeric field
    validated across the API should reject booleans the same way.
    """
    if type(value) is not int:
        return False
    if min_value is not None and value < min_value:
        return False
    if max_value is not None and value > max_value:
        return False
    return True
