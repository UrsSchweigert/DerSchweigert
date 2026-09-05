"""Shared Flask extension instances.

A single `Limiter` instance must be created here and reused by every
blueprint. Creating a second, separate `Limiter()` in a blueprint module
(as auth.py used to do) never gets `init_app()`-bound to the real Flask
app, so its `before_request` enforcement hook never registers and its
`@limiter.limit(...)` decorators silently do nothing.
"""
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address

limiter = Limiter(key_func=get_remote_address, default_limits=["200/day", "50/hour"])
