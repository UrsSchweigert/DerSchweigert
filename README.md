# DerSchweigert

Monorepo for the sites hosted under `derschweigert.de`, plus `landhauscheck.com`
(which predates the monorepo and keeps its own domain). Each site has its own app
under `sites/`, and shared infrastructure building blocks live under
`infra/terraform/modules/`.

## Repository structure

```
sites/
  derschweigert/   # www.derschweigert.de — FastAPI app, templates, static assets, Lambda API, tests
  ffm/              # ffm.derschweigert.de — Arithmo Slayer static game + Flask API
  lesen/            # lesen.derschweigert.de — standalone reading-practice page
  landhauscheck/    # landhauscheck.com — React/Vite SPA + FastAPI Lambda (own domain, eu-west-1)
infra/
  terraform/
    modules/        # shared Terraform modules (static_site, api_backend) used by every site stack
    sites/
      derschweigert/  # root module for derschweigert.de + www
      ffm/            # dedicated FFM stack (static site + API backend)
      lesen/          # dedicated static-site stack for lesen.derschweigert.de
      landhauscheck/  # prod stack for landhauscheck.com (own CloudFront/API/Lambda, eu-west-1)
      landhauscheck-dev/ # dev stack for dev.landhauscheck.com
tools/
  harness/          # development harness: plans, approves, and runs AI-built work (see tools/harness/README.md)
docs/
  harness/          # harness spec, security model, state machines, and decisions
requirements.txt      # shared Python dependency baseline
pytest.ini            # points pytest at sites/derschweigert/tests and tools/harness/tests
```

## Development harness

`tools/harness/` is a stage-gated harness that turns a requirements file into reviewed, merged pull requests: an investigator drafts a plan, you approve it once, and sandboxed AI workers build it issue by issue. Every merge to `main` deploys to production. Start with the manual: [`tools/harness/README.md`](tools/harness/README.md).

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

## Arithmo Slayer / FFM

Arithmo Slayer now lives under `sites/ffm/`. For the current system overview, architecture notes, and working gotchas, start with [`sites/ffm/README.md`](sites/ffm/README.md).

## Environment

The app loads `sites/derschweigert/.env` automatically when it starts, so local and production values stay in one place.

## Domain / Route53 note

The configured production domains for this project are `derschweigert.de` / `www.derschweigert.de`, `ffm.derschweigert.de`, and `lesen.derschweigert.de`. In Route53, keep the apex + `www` aliases aligned with the derschweigert stack and each subdomain record aligned with its own Terraform stack.

## Minimal Route53 setup

1. Create a hosted zone for `derschweigert.de`.
2. Add an A/AAAA or CloudFront alias record for the apex domain.
3. Add a second record for `www` that points to the same origin.
4. Verify the site with HTTPS and test the admin cookie flow after deployment.

## Deployments

There are two deployment shapes supported by the shared Terraform modules
(`infra/terraform/modules/static_site` and `infra/terraform/modules/api_backend`):

### Shared deployment (historical / optional pattern)

A subdomain can "ride" an existing site's CloudFront distribution before it has
its own app: add the subdomain to that stack's `additional_aliases` list (and
therefore the ACM certificate's SAN list) and add a matching exemption in the
CloudFront viewer-request function if the target site is behind the PIN lock.
This was the bootstrap pattern before FFM had its own stack.

Pros: zero extra infra/cost. Cons: the subdomain's availability and deploys are
coupled to the parent stack (e.g. any CloudFront/ACM change touches both).

### Independent deployment (a site gets its own stack)

This is the current shape for FFM under `infra/terraform/sites/ffm/`, and the
recommended shape for any real standalone site:

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

The single-page reading practice site at `lesen.derschweigert.de` is deployed
independently by `deploy-lesen` in the GitHub Actions workflow. Its source page
is `sites/lesen/static/index.html`. The word mode loads
`sites/lesen/static/words-de.json` (CC BY-SA 4.0, see `words-de-LICENSE.txt`),
which is regenerated with `python3 sites/lesen/tools/build_wordlist.py`;
add child-inappropriate words to `sites/lesen/tools/blocklist-de.txt`.

### landhauscheck.com (pre-monorepo stack)

`sites/landhauscheck/` was migrated out of a standalone repository. Unlike the
other sites, its Terraform is **not** built on the shared `static_site` /
`api_backend` modules: porting it onto them would have replaced its live
CloudFront distribution, ACM certificate, REST/HTTP API and S3 buckets, so the
stack was moved as-is to preserve resource addresses. Consequences worth knowing:

- Region is **eu-west-1** (the other sites are eu-central-1); it is a per-stack
  variable, so nothing forces the two to match.
- IaC is **OpenTofu** (`tofu`, 1.11.5) — the state was created by it. The
  `deploy-lhc` job installs OpenTofu rather than Terraform.
- State keys are `landhauscheck/prod/terraform.tfstate` and
  `landhauscheck/dev/terraform.tfstate` in the shared bucket.
- The Lambda deploys as a **zip** built by `sites/landhauscheck/scripts/deploy.sh`
  (the other sites' module zips their source); Terraform sets
  `ignore_changes = [s3_key]` so infrastructure-only applies never revert code.
- It keeps its own domain (`landhauscheck.com` + `www`) in its own Route53 zone.

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
- **CI**: `.github/workflows/deploy.yml` has a `changes` job, a test and a
  deploy job per site, and `check-secrets`. `changes` reads the changed paths
  and reports per-site test/deploy gates, so a change only tests and deploys
  the sites it touches; a shared `infra/*` change touches every site, and a
  change set that cannot be listed is treated as touching everything.
  `test` (derschweigert pytest, harness pytest, and lesen's node tests),
  `test-ffm` (ffm pytest, standalone), and `test-lhc` (ruff, pytest, Vitest,
  Vite build) run on both `push` to `main` and `pull_request` into `main`. The
  deploy jobs — `deploy` (derschweigert terraform apply + static sync),
  `deploy-ffm` (ffm terraform apply + Lambda code push + static sync),
  `deploy-lesen` (lesen terraform apply + static sync), and `deploy-lhc`
  (OpenTofu apply + Lambda zip + frontend sync) — additionally require
  `github.ref == 'refs/heads/main'` plus their own gate, so they never run for
  a PR. `deploy-ffm` is gated on its deploy flag rather than its test flag, so
  a terraform-only change is still applied; `deploy-lesen` waits for `test`,
  which is where lesen's node tests live; and `deploy-lhc` pins
  `TF_VAR_aws_region: eu-west-1` because that stack lives in eu-west-1,
  unlike the others. The required status checks on `main` are `test` and
  `test-ffm`.
  Required GitHub secrets: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`,
  `AWS_SESSION_TOKEN` (optional), `AWS_REGION` (optional, defaults to
  `eu-central-1`), `ROUTE53_ZONE_ID`.
- **CI's IAM permissions live outside this repo — read this before adding any
  new AWS resource type.** Every deploy job authenticates as IAM user
  `derschweigert-ci-deploy`, whose permissions come from a customer-managed
  policy (`derschweigert-deploy-scope`) that is **hand-maintained in AWS IAM,
  not defined anywhere in `infra/terraform/`.** There is no drift check
  between what a `.tf` file needs and what that policy grants — a `terraform
  apply` step can be green in a PR's `test`/`test-ffm` jobs and then fail in a
  deploy job purely on `AccessDenied`. This bit a 2026-09-05 session
  hard: `deploy-ffm` had never actually run `terraform apply` before that day,
  and turned out to be missing DynamoDB/Secrets Manager/CloudFront/IAM
  permissions for resources that had existed for a while. See
  [`sites/ffm/README.md`](sites/ffm/README.md)'s "CI's AWS IAM permissions are
  NOT managed in this repo" section for the exact `aws iam` commands to
  inspect/update it, the 5-versions-per-policy cap, and the current (v17)
  permission set. It happened again on 2026-09-06: adding the
  `email_forwarding` module (SES receiving + S3 + Lambda forwarder for
  `info@derschweigert.de`) failed CI with `AccessDenied` on
  `s3:GetBucketPublicAccessBlock`/`s3:GetBucketPolicy`, `iam:GetRole`, and
  `ses:DescribeReceiptRuleSet` even though the same `terraform apply` had
  already succeeded locally under root credentials — a reminder that a
  clean local apply proves nothing about whether CI can do the same.

  It happened a third time on 2026-10-29 when `deploy-lhc` was added: the
  landhauscheck stack predates this monorepo and its resources are named
  `basicwebapp-*` rather than `derschweigert-*`, so `derschweigert-deploy-scope`
  matched none of them and the first Lambda zip upload failed with
  `AccessDenied` on `s3:PutObject`. Rather than widen the shared policy, the
  landhauscheck permissions live in a **second** hand-maintained policy,
  `landhauscheck-deploy-scope`, attached to the same `derschweigert-ci-deploy`
  user and scoped to the `basicwebapp-*` buckets, the two `basicwebapp-*`
  Lambdas, their execution roles, `/basicwebapp*` SSM parameters, their log
  groups (eu-west-1) and the `basicwebapp-backend` ECR repository. CloudFront,
  ACM, Route53 and API Gateway need no new grant because those statements in
  `derschweigert-deploy-scope` use `Resource: "*"`. Inspect it with
  `aws iam get-policy-version --policy-arn arn:aws:iam::113725432218:policy/landhauscheck-deploy-scope --version-id <id>`;
  it has the same 5-version cap and the same absence of drift checking, so a
  new resource type in the landhauscheck stack needs the same manual grant.
- **PIN lock (optional, disabled by default)**: production traffic to derschweigert.de/www can be optionally gated by a PIN. The feature is controlled by two independent configuration points: (1) **FastAPI layer**: set `PIN_PROTECTION_ENABLED` environment variable (default `false`) locally or in `sites/derschweigert/.env`; (2) **CloudFront layer**: set the Terraform variable `pin_protection_enabled` (default `false`) in `infra/terraform/sites/derschweigert/variables.tf` or via CI using `TF_VAR_pin_protection_enabled` environment variable (sourced from repo variable `DERSCHWEIGERT_PIN_PROTECTION_ENABLED` in the deploy workflow). When enabled, traffic is gated by an `ams_pin=1` cookie, except for a small allowlist of public paths (`/health`, `/unlock`, `/static/*`, `/impressum`, `/datenschutz`). FFM has its own stack, so its access policy is independent. The PIN value itself is defined in `module "api"`'s `environment_variables` in `infra/terraform/sites/derschweigert/main.tf` — treat it like any other credential when changing it (don't paste into chat/commits). The contact form (`/contact` GET and `/api/contact` POST) has been retired and returns 410 Gone; contact links in templates route to `mailto:info@derschweigert.de` instead.
- **Security response headers**: the shared `static_site` module
  (`infra/terraform/modules/static_site/main.tf`) provisions a CloudFront
  response-headers policy (CSP, HSTS, X-Frame-Options, nosniff,
  referrer-policy) applied to every site that uses this module — derschweigert,
  ffm, and lesen get it automatically. The default CSP
  (`var.content_security_policy`) assumes same-origin-only assets with no
  external CDNs/fonts and allows inline `style="..."` attributes but not
  inline `<script>`; override the variable per-site if that stops being true.
  The lesen page is self-contained with inline JavaScript, so its stack allows
  inline scripts without relaxing the CSP for external sources.
  FFM does exactly this in `infra/terraform/sites/ffm/main.tf` (`module
  "site"`'s `content_security_policy`), adding `https://challenges.cloudflare.com`
  to `script-src`/`frame-src` for the Cloudflare Turnstile CAPTCHA widget (see
  `sites/ffm/README.md`'s CAPTCHA section) — without it the browser silently
  blocks Turnstile's script, so the widget never renders/produces a token and
  the backend (which fails closed) rejects every register/forgot-password/
  resend-verification request, not just bots'.
- **Env file**: `app/config.py`'s `BASE_DIR` resolves relative to the `app/`
  package, so each site's `.env` must live at `sites/<name>/.env`, not the repo
  root.
- **Tests**: run `pytest` from the repo root; `pytest.ini` sets
  `pythonpath = sites/derschweigert` and `testpaths = sites/derschweigert/tests`
  so `from app.main import app` resolves without extra config. A new
  independent site will need its own pytest config (or a multi-root setup) if
  it also uses this pattern. FFM's tests live under `sites/ffm/tests/` and are
  run explicitly by the `test-ffm` CI job and by
  `pip install -r sites/ffm/requirements-dev.txt && SECRET_KEY=... pytest sites/ffm/tests/`
  locally — they are not picked up by the root `pytest.ini` config.
- **Lambda build artifacts**: `infra/terraform/modules/api_backend` zips the
  Lambda source into `<root-module>/.terraform-build/`, which is gitignored —
  don't expect it to appear in git status, and don't manually edit `.zip` files.
- **FFM's Lambda deploy has a deliberate Terraform/code split**: Terraform's
  own zip for `ffm-api` only contains `lambda/handler.py` (no dependencies),
  since bundling Lambda-compatible wheels isn't something Terraform does well.
  The real, dependency-bundled code is built and pushed separately via
  `aws lambda update-function-code` in the same CI job, immediately after
  `terraform apply`. This means a `terraform apply` for ffm briefly leaves the
  Lambda non-functional until the very next step overwrites it — see
  `sites/ffm/README.md`'s "Deployment shape" section for the full trade-off
  and the fix if it's ever worth removing.

## Licence

Copyright (c) 2026 Urs Schweigert. Licensed under the
[PolyForm Strict License 1.0.0](LICENSE): noncommercial use only, no
distribution, no changes or derivative works. See [`NOTICE`](NOTICE).
Third-party components (word lists, fonts, dependencies) keep their own
licences, listed in `sites/lesen/docs/third-party-licences.md`.
