# Dev Fixture Cache

This directory contains pre-recorded external API responses used when
`DEV_CACHE_MODE=on` (or `record`) is set on the backend.

## File naming

Each file is named `<key>.json` where `<key>` is the first 20 hex characters of
`SHA-256(METHOD|clean-url|request-body)` — API key query parameters are stripped
before hashing so rotating secrets never invalidates fixtures.

## Seeding / refreshing

```bash
# 1. Start the local backend in record mode
DEV_CACHE_MODE=record docker-compose -f sites/landhauscheck/docker/docker-compose.local.yml up --build -d

# 2. Run the seed script (from the repo root)
python scripts/seed_dev_fixtures.py

# 3. Review the new files, then commit them
git add sites/landhauscheck/app/data/fixtures/*.json
git commit -m "chore: refresh dev fixtures (Singen seed)"
```

## Bypass (per-request)

To hit the live API for a single request while the backend is running in `on` mode:

```
GET /api/v1/weather/forecast?lat=47.76&lng=8.84
X-Dev-Cache-Bypass: 1
```

## Fixture envelope format

```json
{
  "meta": {
    "url": "https://upstream-api.example.com/endpoint?param=value&key=REDACTED",
    "method": "GET",
    "note": "Auto-recorded by DEV_CACHE_MODE=record. Review before committing."
  },
  "status": 200,
  "body": { ... }
}
```
