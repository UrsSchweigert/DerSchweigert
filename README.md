# DerSchweigert

Monorepo for the sites hosted under `derschweigert.de`. Each subdomain has its own
app under `sites/`, and shared infrastructure building blocks live under
`infra/terraform/modules/`.

## Repository structure

```
sites/
  derschweigert/   # www.derschweigert.de — FastAPI app, templates, static assets, Lambda API, tests
  ffm/              # ffm.derschweigert.de — reserved for the "Final Fantasy Math" game (not yet implemented)
infra/
  terraform/
    modules/        # shared Terraform modules (static_site, api_backend) used by every site stack
    sites/
      derschweigert/  # root module for derschweigert.de + www + ffm alias (current live infra)
      ffm/            # reserved for FFM's own stack once it has content
requirements.txt      # shared Python dependency baseline
pytest.ini            # points pytest at sites/derschweigert/tests
```

## Local development (derschweigert.de)

1. Create a virtual environment and install dependencies:
   - `python -m venv .venv`
   - `source .venv/bin/activate`
   - `pip install -r requirements.txt`
2. Start the app:
   - `uvicorn app.main:app --reload --host 0.0.0.0 --port 8000 --app-dir sites/derschweigert`
3. Open:
   - `http://localhost:8000/`

## Running tests

- `pytest` (uses `pytest.ini` to target `sites/derschweigert/tests`)

## Environment

The app loads `sites/derschweigert/.env` automatically when it starts, so local and production values stay in one place.

## Domain / Route53 note

The configured production domain for this project is `derschweigert.de`. In Route53, create the hosted zone and add an apex plus `www` alias record pointing at your app host or CDN, then keep the `APP_DOMAIN` and `SITE_URL` values aligned with the live entry point. `ffm.derschweigert.de` currently aliases the same CloudFront distribution until it has dedicated infrastructure.

## Minimal Route53 setup

1. Create a hosted zone for `derschweigert.de`.
2. Add an A/AAAA or CloudFront alias record for the apex domain.
3. Add a second record for `www` that points to the same origin.
4. Verify the site with HTTPS and test the admin cookie flow after deployment.

## Deployments

There are two deployment shapes supported by the shared Terraform modules
(`infra/terraform/modules/static_site` and `infra/terraform/modules/api_backend`):

### Shared deployment (current state of `ffm.derschweigert.de`)

A subdomain can "ride" an existing site's CloudFront distribution before it has
its own app: add the subdomain to that stack's `additional_aliases` list (and
therefore the ACM certificate's SAN list) and add a matching exemption in the
CloudFront viewer-request function if the target site is behind the PIN lock.
This is what `ffm.derschweigert.de` does today inside
[`infra/terraform/sites/derschweigert/main.tf`](infra/terraform/sites/derschweigert/main.tf) —
there is no dedicated S3 bucket, CloudFront distribution, or Lambda for FFM yet.

Pros: zero extra infra/cost. Cons: FFM's availability and deploys are coupled to
derschweigert.de's stack (e.g. any CloudFront/ACM change touches both).

### Independent deployment (a site gets its own stack)

When a site (e.g. FFM) has real content and should be deployed independently:

1. Add real app code under `sites/<name>/` (see `sites/derschweigert` as the
   reference layout: `app/`, `templates/`, `static/`, `lambda/`, `tests/`).
2. Create `infra/terraform/sites/<name>/{main.tf,variables.tf,outputs.tf}`.
   Give it **its own S3 backend state key**, e.g.:
   ```hcl
   backend "s3" {
     bucket         = "derschweigert-terraform-state"
     key            = "<name>/prod/terraform.tfstate"   # unique per site
     region         = "eu-central-1"
     encrypt        = true
     dynamodb_table = "derschweigert-terraform-locks"
   }
   ```
   The S3 state bucket and DynamoDB lock table are shared/reused across sites —
   only the `key` needs to be unique per site.
3. Instantiate `module "site"` (static_site) and, if the site needs a backend,
   `module "api"` (api_backend) — see `infra/terraform/sites/derschweigert/main.tf`
   for a full example, including how to pass the `aws.us_east_1` provider alias
   required for the ACM certificate (CloudFront certs must live in us-east-1).
4. Run `terraform -chdir=infra/terraform/sites/<name> init` then `plan`/`apply`.
   This creates a brand-new CloudFront distribution, ACM cert, and Route53
   alias for that site — independent from every other site's stack.
5. Remove the subdomain from the old shared stack's `additional_aliases` (and
   its cert SAN / pin-lock exemption) once the new stack's Route53 alias is
   live, so DNS only points at one distribution at a time.
6. Add a deploy job for the new site (copy the pattern in
   [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)), pointing at
   `infra/terraform/sites/<name>` and `sites/<name>/{templates,static}`.

### Refactoring live infra safely (moved blocks)

If you ever need to reshuffle resources between root config and modules again
(e.g. renaming, re-nesting), use Terraform `moved` blocks instead of deleting
and recreating resource definitions. This lets `terraform plan` reconcile state
without destroying/recreating real AWS resources (CloudFront distributions and
ACM certs are expensive to needlessly replace — cert replacement forces a fresh
DNS validation round-trip and briefly changes the distribution's cert ARN).
Always run `plan` after adding `moved` blocks and confirm no unexpected
`create`/`destroy` actions before applying.

## Notes for future sessions

- **AWS account**: `113725432218`, default region `eu-central-1`. ACM
  certificates for CloudFront must be requested in `us-east-1` regardless of
  the app's region (see the `aws.us_east_1` provider alias).
- **Terraform backend**: S3 bucket `derschweigert-terraform-state` + DynamoDB
  lock table `derschweigert-terraform-locks`, both shared across all site
  stacks. Only the state `key` differs per site.
- **Route53 zone**: `derschweigert.de` hosted zone ID `Z02407051JK3BF2C58UEQ`
  (shared across all subdomains/sites — no need to create a new zone for a new
  subdomain, just add records/aliases in the relevant site's Terraform stack).
- **CI**: `.github/workflows/deploy.yml` runs tests, then `terraform apply` for
  `infra/terraform/sites/derschweigert`, then syncs `sites/derschweigert/{templates,static}`
  to the site's S3 bucket and invalidates CloudFront. It only deploys the
  derschweigert.de stack today — a new independent site needs its own job.
  Required GitHub secrets: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`,
  `AWS_SESSION_TOKEN` (optional), `AWS_REGION` (optional, defaults to
  `eu-central-1`), `ROUTE53_ZONE_ID`.
- **PIN lock**: production traffic to derschweigert.de/www is gated by a
  CloudFront Function (`derschweigert-pin-lock`) requiring an `ams_pin=1`
  cookie, except for a small allowlist of public paths (`/health`, `/unlock`,
  `/static/*`, `/api/*`, `/contact`, `/impressum`, `/datenschutz`) and any host
  under `ffm.derschweigert.de` (exempted since FFM is a separate, non-locked
  audience). If FFM ever needs its own lock behavior, update
  `local.pin_lock_function_code` in the derschweigert stack (or give FFM its
  own CloudFront function once it has an independent stack).
  The PIN value itself is defined in `module "api"`'s `environment_variables`
  in `infra/terraform/sites/derschweigert/main.tf` — treat it like any other
  credential when changing it (don't casually paste it into chat/commits).
- **Env file**: `app/config.py`'s `BASE_DIR` resolves relative to the `app/`
  package, so each site's `.env` must live at `sites/<name>/.env`, not the repo
  root.
- **Tests**: run `pytest` from the repo root; `pytest.ini` sets
  `pythonpath = sites/derschweigert` and `testpaths = sites/derschweigert/tests`
  so `from app.main import app` resolves without extra config. A new
  independent site will need its own pytest config (or a multi-root setup) if
  it also uses this pattern.
- **Lambda build artifacts**: `infra/terraform/modules/api_backend` zips the
  Lambda source into `<root-module>/.terraform-build/`, which is gitignored —
  don't expect it to appear in git status, and don't manually edit `.zip` files.
