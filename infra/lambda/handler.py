import json
import os
from urllib.parse import parse_qs, quote
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


def lambda_handler(event, context):
    method = event.get("httpMethod", "GET")
    route = event.get("path", "/")

    if route == "/unlock":
        if method == "POST":
            return _handle_unlock_submit(event)
        return _handle_unlock_page(event)

    if route == "/api/contact":
        if method != "POST":
            return _respond(405, {"detail": "Method not allowed"})
        body = json.loads(event.get("body") or "{}")
        name = str(body.get("name", "")).strip()
        email = str(body.get("email", "")).strip()
        message = str(body.get("message", "")).strip()

        if not name or "@" not in email or not message:
            return _respond(400, {"detail": "Missing required fields"})

        if len(name) > 200 or len(email) > 320 or len(message) > 10_000:
            return _respond(400, {"detail": "Message is too long"})

        try:
            token = _get_github_token()
            _create_github_issue(
                token=token,
                repository=os.getenv("GITHUB_CONTACT_REPOSITORY", "UrsSchweigert/DerSchweigert"),
                name=name,
                email=email,
                message=message,
            )
        except (HTTPError, URLError, ValueError, RuntimeError):
            return _respond(502, {"detail": "Ihre Nachricht konnte nicht gesendet werden. Bitte versuchen Sie es später erneut."})

        return _respond(200, {"ok": True, "message": "Vielen Dank. Ihre Nachricht wurde gesendet."})

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


def _get_github_token():
    secret_arn = os.getenv("GITHUB_CONTACT_SECRET_ARN", "")
    if not secret_arn:
        raise ValueError("Missing GitHub contact secret ARN")

    import boto3
    from botocore.exceptions import ClientError

    try:
        response = boto3.client("secretsmanager").get_secret_value(SecretId=secret_arn)
    except ClientError as error:
        raise RuntimeError("GitHub contact token could not be read") from error
    token = response.get("SecretString", "").strip()
    if not token:
        raise ValueError("Empty GitHub contact token")
    return token


def _create_github_issue(token, repository, name, email, message):
    issue_body = "\n".join([
        "## Neue Kontaktanfrage",
        "",
        f"**Name:** {name}",
        f"**E-Mail:** {email}",
        "",
        "### Nachricht",
        message,
    ])
    payload = json.dumps({
        "title": f"Kontakt: {name}",
        "body": issue_body,
    }).encode("utf-8")
    request = Request(
        f"https://api.github.com/repos/{repository}/issues",
        data=payload,
        method="POST",
        headers={
            "Accept": "application/vnd.github+json",
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "User-Agent": "derschweigert-contact-form",
            "X-GitHub-Api-Version": "2022-11-28",
        },
    )
    with urlopen(request, timeout=10) as response:
        if response.status != 201:
            raise ValueError("GitHub issue creation failed")
        return json.loads(response.read().decode("utf-8"))


def _handle_unlock_page(event, error=False):
    query = event.get("queryStringParameters") or {}
    next_path = query.get("next", "/")
    escaped_next = next_path.replace("'", "&apos;")
    error_html = (
        '<p class="error">Falscher PIN. Bitte erneut versuchen.</p>' if error else ""
    )
    html = f"""
    <!DOCTYPE html>
    <html lang="de">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>Seite gesperrt</title>
      <style>
        body {{ font-family: sans-serif; background: #eef4fb; color: #14253d; margin: 0; display: grid; place-items: center; min-height: 100vh; }}
        .box {{ width: min(420px, calc(100% - 32px)); background: white; border-radius: 18px; box-shadow: 0 24px 56px rgba(10,47,95,0.12); padding: 28px; }}
        h1 {{ margin-top: 0; font-size: 1.8rem; }}
        input {{ width: 100%; box-sizing: border-box; padding: 12px 14px; border-radius: 10px; border: 1px solid rgba(20,37,61,0.12); margin: 10px 0 16px; font-size: 1rem; }}
        button {{ width: 100%; padding: 12px 14px; border: none; border-radius: 10px; background: linear-gradient(135deg, #0f4c81, #0a2f5f); color: white; font-weight: 700; cursor: pointer; }}
        .error {{ color: #8d1f1f; margin-top: 10px; font-weight: 600; }}
      </style>
    </head>
    <body>
      <div class="box">
        <h1>Seite gesperrt</h1>
        <p>Bitte geben Sie den PIN ein, um die Seite zu öffnen.</p>
        <form method="post" action="/unlock">
          <input type="password" name="pin" placeholder="PIN eingeben" required />
          <input type="hidden" name="next" value="{escaped_next}" />
          <button type="submit">Freischalten</button>
        </form>
        {error_html}
      </div>
    </body>
    </html>
    """
    return _respond_html(200, html)


def _handle_unlock_submit(event):
    content_type = _get_header(event, "content-type") or ""
    body_raw = event.get("body") or ""
    if event.get("isBase64Encoded"):
        import base64
        body_raw = base64.b64decode(body_raw).decode("utf-8")

    if "application/json" in content_type:
        payload = json.loads(body_raw or "{}")
    else:
        parsed = parse_qs(body_raw)
        payload = {k: v[0] for k, v in parsed.items()}

    pin = str(payload.get("pin", "")).strip()
    next_path = str(payload.get("next", "/")) or "/"
    expected = os.getenv("ADMIN_PIN", "123456")

    if pin == expected:
        return {
            "statusCode": 302,
            "headers": {
                "Location": next_path,
                "Set-Cookie": "ams_pin=1; Path=/; Max-Age=2592000; HttpOnly; SameSite=Lax; Secure",
                "Cache-Control": "no-store",
            },
            "body": "",
        }

    return _handle_unlock_page(
        {"queryStringParameters": {"next": next_path}}, error=True
    )


def _get_header(event, name):
    headers = event.get("headers") or {}
    for key, value in headers.items():
        if key.lower() == name.lower():
            return value
    return None


def _respond_html(status_code, html):
    return {
        "statusCode": status_code,
        "headers": {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "no-store",
        },
        "body": html,
    }


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
