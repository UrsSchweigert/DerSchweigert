# AmSonnenhang

A lightweight portfolio site for services-for-hire.

## Local development

1. Create a virtual environment and install dependencies:
   - `python -m venv .venv`
   - `source .venv/bin/activate`
   - `pip install -r requirements.txt`
2. Start the app:
   - `uvicorn app.main:app --reload --host 0.0.0.0 --port 8000`
3. Open:
   - `http://localhost:8000/`

## Environment

The app loads `.env` automatically when it starts, so local and production values stay in one place.

## Domain / Route53 note

The configured production domain for this project is `derschweigert.de`. In Route53, create the hosted zone and add an apex plus `www` alias record pointing at your app host or CDN, then keep the `APP_DOMAIN` and `SITE_URL` values aligned with the live entry point.

## Minimal Route53 setup

1. Create a hosted zone for `derschweigert.de`.
2. Add an A/AAAA or CloudFront alias record for the apex domain.
3. Add a second record for `www` that points to the same origin.
4. Verify the site with HTTPS and test the admin cookie flow after deployment.
