from __future__ import annotations

from pathlib import Path

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


@app.get("/", response_class=HTMLResponse)
def index() -> HTMLResponse:
    return HTMLResponse((TEMPLATES_DIR / "index.html").read_text(encoding="utf-8"))


@app.get("/services/{slug}", response_class=HTMLResponse)
def service_page(slug: str) -> HTMLResponse:
    path = TEMPLATES_DIR / "services" / f"{slug}.html"
    if not path.exists():
        raise HTTPException(status_code=404, detail="Service not found")
    return HTMLResponse(path.read_text(encoding="utf-8"))


@app.get("/contact", response_class=HTMLResponse)
def contact_page() -> HTMLResponse:
    return HTMLResponse((TEMPLATES_DIR / "contact.html").read_text(encoding="utf-8"))


@app.get("/impressum", response_class=HTMLResponse)
def impressum_page() -> HTMLResponse:
    return HTMLResponse((TEMPLATES_DIR / "impressum.html").read_text(encoding="utf-8"))


@app.get("/datenschutz", response_class=HTMLResponse)
def privacy_page() -> HTMLResponse:
    return HTMLResponse((TEMPLATES_DIR / "datenschutz.html").read_text(encoding="utf-8"))


@app.get("/admin", response_class=HTMLResponse)
def admin_page(request: Request) -> HTMLResponse:
    if request.cookies.get(settings.admin_cookie_name) != "1":
        raise HTTPException(status_code=403, detail="Forbidden")
    return HTMLResponse((TEMPLATES_DIR / "admin.html").read_text(encoding="utf-8"))


@app.post("/api/admin/verify-pin")
def verify_pin(payload: dict):
    pin = str(payload.get("pin", "")).strip()
    if pin != settings.admin_pin:
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


@app.post("/api/contact")
def submit_contact(payload: dict):
    name = str(payload.get("name", "")).strip()
    email = str(payload.get("email", "")).strip()
    message = str(payload.get("message", "")).strip()
    if not name or not email or not message:
        raise HTTPException(status_code=400, detail="Missing required fields")

    return {"ok": True, "message": "Thanks — I will get back to you soon."}
