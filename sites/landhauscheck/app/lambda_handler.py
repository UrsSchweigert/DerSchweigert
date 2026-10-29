"""AWS Lambda entrypoint — wraps the FastAPI app with Mangum.

Mangum translates the API Gateway HTTP API (payload format 2.0) event into a
standard ASGI request and returns an API Gateway response dict.

lifespan="off" disables ASGI lifespan because Lambda reuses the execution
environment and does not cleanly support startup/shutdown events.
"""
from mangum import Mangum

from app.main import app

handler = Mangum(app, lifespan="off")
