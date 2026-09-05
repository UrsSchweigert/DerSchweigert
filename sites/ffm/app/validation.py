"""Shared request-payload validation helpers."""


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
