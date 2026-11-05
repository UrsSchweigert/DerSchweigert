from __future__ import annotations

from pathlib import Path
from urllib.parse import quote

from fastapi import FastAPI, Form, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from starlette.background import BackgroundTask

from app.config import get_settings

settings = get_settings()
app = FastAPI(title=settings.app_name, version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

BASE_DIR = Path(__file__).resolve().parent.parent
TEMPLATES_DIR = BASE_DIR / "templates"
STATIC_DIR = BASE_DIR / "static"

if STATIC_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


@app.middleware("http")
async def pin_protection(request: Request, call_next):
    forwarded_host = request.headers.get("x-forwarded-host") or request.headers.get("host") or ""
    host = forwarded_host.split(":", 1)[0].lower()
    if host == settings.domain and host != settings.canonical_host:
        return await call_next(request)

    path = request.url.path
    # Impressum/Datenschutz must stay reachable without the PIN gate: German
    # law (§ 5 DDG) requires a site's legal notice to be "leicht erkennbar,
    # unmittelbar erreichbar" (easily recognizable, directly accessible)
    # without any access barrier, even while the rest of the site is behind
    # a pre-launch PIN wall.
    public_paths = {"/health", "/unlock", "/api/admin/verify-pin", "/contact", "/api/contact", "/impressum", "/datenschutz", "/nutzungsbedingungen"}

    # Apply PIN protection only if explicitly enabled
    if settings.pin_protection_enabled and settings.app_env == "production" and not path.startswith("/static") and path not in public_paths:
        if request.cookies.get(settings.admin_cookie_name) != "1":
            redirect_to = f"/unlock?next={quote(path or '/')}"
            return RedirectResponse(url=redirect_to, status_code=307)

    response = await call_next(request)
    return response


@app.middleware("http")
async def canonical_host_redirect(request: Request, call_next):
    forwarded_proto = request.headers.get("x-forwarded-proto", request.url.scheme)
    forwarded_host = request.headers.get("x-forwarded-host") or request.headers.get("host") or ""
    host = forwarded_host.split(":", 1)[0].lower()
    redirect_proto = forwarded_proto if forwarded_proto == "https" else "https" if host not in {"localhost", "127.0.0.1"} else "http"

    if host == settings.domain and host != settings.canonical_host:
        redirect_url = f"{redirect_proto}://{settings.canonical_host}{request.url.path}"
        if request.url.query:
            redirect_url = f"{redirect_url}?{request.url.query}"
        return RedirectResponse(url=redirect_url, status_code=308)

    response = await call_next(request)
    return response


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "geolocation=(), camera=(), microphone=()"
    return response


@app.get("/health")
def health():
    return {"status": "ok", "service": settings.app_name.lower()}


@app.get("/unlock", response_class=HTMLResponse)
def unlock_page(request: Request) -> HTMLResponse:
    next_path = request.query_params.get("next", "/")
    escaped_next = next_path.replace("'", "&apos;")
    return HTMLResponse(
        f"""
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
          </div>
        </body>
        </html>
        """
    )


@app.post("/unlock")
def unlock_submit(pin: str = Form(...), next: str = Form("/")):
    if settings.admin_pin and pin.strip() == settings.admin_pin:
        response = RedirectResponse(url=next or "/", status_code=302)
        response.set_cookie(
            key=settings.admin_cookie_name,
            value="1",
            max_age=30 * 24 * 60 * 60,
            path="/",
            secure=settings.app_env == "production",
            httponly=True,
            samesite="lax",
        )
        return response

    return HTMLResponse(
        """
        <!DOCTYPE html>
        <html lang="de">
        <head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>PIN falsch</title></head>
        <body style="font-family:sans-serif;background:#eef4fb;color:#14253d;display:grid;place-items:center;min-height:100vh;">
          <div style="background:white;padding:28px;border-radius:18px;box-shadow:0 24px 56px rgba(10,47,95,0.12);width:min(420px,calc(100% - 32px));">
            <h1>PIN falsch</h1>
            <p>Der eingegebene PIN ist ungültig.</p>
            <p><a href="/unlock" style="color:#0f4c81;font-weight:700;">Erneut versuchen</a></p>
          </div>
        </body>
        </html>
        """,
        status_code=401,
    )


@app.get("/", response_class=HTMLResponse)
def index() -> HTMLResponse:
    return HTMLResponse((TEMPLATES_DIR / "index.html").read_text(encoding="utf-8"))


@app.get("/services/{slug}", response_class=HTMLResponse)
def service_page(slug: str) -> HTMLResponse:
    path = TEMPLATES_DIR / "services" / f"{slug}.html"
    if not path.exists():
        raise HTTPException(status_code=404, detail="Service not found")
    return HTMLResponse(path.read_text(encoding="utf-8"))


@app.get("/impressum", response_class=HTMLResponse)
def impressum_page() -> HTMLResponse:
    return HTMLResponse((TEMPLATES_DIR / "impressum.html").read_text(encoding="utf-8"))


@app.get("/datenschutz", response_class=HTMLResponse)
def privacy_page() -> HTMLResponse:
    return HTMLResponse((TEMPLATES_DIR / "datenschutz.html").read_text(encoding="utf-8"))


@app.get("/nutzungsbedingungen", response_class=HTMLResponse)
def terms_page() -> HTMLResponse:
    return HTMLResponse((TEMPLATES_DIR / "nutzungsbedingungen.html").read_text(encoding="utf-8"))


@app.get("/admin", response_class=HTMLResponse)
def admin_page(request: Request) -> HTMLResponse:
    if request.cookies.get(settings.admin_cookie_name) != "1":
        raise HTTPException(status_code=403, detail="Forbidden")
    return HTMLResponse((TEMPLATES_DIR / "admin.html").read_text(encoding="utf-8"))


@app.post("/api/admin/verify-pin")
def verify_pin(payload: dict):
    pin = str(payload.get("pin", "")).strip()
    if not settings.admin_pin or pin != settings.admin_pin:
        raise HTTPException(status_code=401, detail="Invalid PIN")

    response = JSONResponse({"ok": True})
    response.set_cookie(
        key=settings.admin_cookie_name,
        value="1",
        max_age=30 * 24 * 60 * 60,
        path="/",
        secure=settings.app_env == "production",
        httponly=True,
        samesite="lax",
    )
    return response


@app.get("/contact", response_class=HTMLResponse)
def contact_page() -> HTMLResponse:
    raise HTTPException(status_code=410, detail="Contact form no longer available")


@app.post("/api/contact")
def submit_contact(payload: dict):
    raise HTTPException(status_code=410, detail="Contact API no longer available")
