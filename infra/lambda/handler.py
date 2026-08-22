import json
import os


def lambda_handler(event, context):
    method = event.get("httpMethod", "GET")
    route = event.get("path", "/")

    if route == "/api/contact":
        if method != "POST":
            return _respond(405, {"detail": "Method not allowed"})
        body = json.loads(event.get("body") or "{}")
        name = str(body.get("name", "")).strip()
        email = str(body.get("email", "")).strip()
        message = str(body.get("message", "")).strip()

        if not name or not email or not message:
            return _respond(400, {"detail": "Missing required fields"})

        return _respond(200, {"ok": True, "message": "Thanks — I will get back to you soon."})

    if route == "/api/admin/verify-pin":
        if method != "POST":
            return _respond(405, {"detail": "Method not allowed"})
        body = json.loads(event.get("body") or "{}")
        pin = str(body.get("pin", "")).strip()
        expected = os.getenv("ADMIN_PIN", "123456")
        if pin != expected:
            return _respond(401, {"detail": "Invalid PIN"})

        return _respond(
            200,
            {"ok": True},
            headers={"Set-Cookie": "ams_pin=1; Path=/; Max-Age=2592000; SameSite=Lax"},
        )

    return _respond(200, {"status": "ok", "service": "derschweigert"})


def _respond(status_code, payload, headers=None):
    return {
        "statusCode": status_code,
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type,Authorization",
            **(headers or {}),
        },
        "body": json.dumps(payload),
    }
