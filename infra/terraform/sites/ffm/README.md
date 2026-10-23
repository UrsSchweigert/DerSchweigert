# ffm.derschweigert.de — infrastructure

`ffm.derschweigert.de` now has its own dedicated Terraform stack in this
folder.

The stack currently provisions:

- `../../modules/static_site` for the static game frontend (includes a
  CloudFront response-headers policy for security headers)
- `../../modules/api_backend` for the Flask `/api/*` backend
- DynamoDB tables `ffm-users`, `ffm-scores`, `ffm-ratelimits` (rate-limit
  counters; see `sites/ffm/app/ratelimit_storage.py`), and `ffm-visits`
  (anonymous daily visitor counts)
- a Secrets Manager secret (`ffm/jwt-secret-key`) holding the JWT signing key,
  passed to the Lambda as `SECRET_KEY_ARN`

Key files:

- `main.tf` — stack wiring
- `backend.tf` — remote Terraform state key (`ffm/prod/terraform.tfstate`)
- `variables.tf` — region/domain/zone inputs
- `outputs.tf` — CloudFront/API/Lambda outputs

**Before adding a new resource type here**, read
[`sites/ffm/README.md`](../../../../sites/ffm/README.md)'s "CI's AWS IAM
permissions are NOT managed in this repo" section — the CI deploy user's IAM
policy is hand-maintained outside Terraform and does not automatically grant
permissions for new resource types.

For the application-level system overview, see
[`sites/ffm/README.md`](../../../../sites/ffm/README.md).

## Visits Analytics Configuration

The `FFM_ADMIN_VISITS_TOKEN` secret is required for the visits analytics
API and must be set in GitHub Actions secrets before deployment.

**Local development / testing:**
Set the environment variable before running Terraform locally:
```bash
export TF_VAR_admin_visits_token="your-secret-token"
terraform -chdir=infra/terraform/sites/ffm plan
```

**⚠️ Important:** When running Terraform locally, ensure that all existing
production billing repository variables are preserved. If testing with
non-production values, make a separate checkout or use `terraform plan`
(never `apply`) to avoid modifying production state.

**GitHub Actions:**
The CI/CD pipeline in `.github/workflows/deploy.yml` automatically injects
`TF_VAR_admin_visits_token` from the `FFM_ADMIN_VISITS_TOKEN` GitHub secret.
A preflight validation step fails the deployment if this secret is missing.

CI also needs DynamoDB lifecycle permissions for `ffm-visits`. On
2026-10-23, the existing managed policy reached IAM's 6,144-character limit.
The CI user therefore has an additional inline policy, `ffm-visits-lifecycle`,
with the existing table lifecycle actions scoped only to
`arn:aws:dynamodb:eu-central-1:113725432218:table/ffm-visits`.
The existing managed policy remains at v17; its previous default was preserved.

## arithmoslayer.de migration

GoDaddy remains the registrar. `domain.tf` manages a separate Route 53 zone;
the existing CloudFront distribution and ACM certificate also cover
`arithmoslayer.de` and `www.arithmoslayer.de`. The shared static-site module's
`route53_zone_ids_by_domain` selects the correct zone for each hostname,
including certificate validation records.

For the initial cutover, do not change the registrar's nameservers until
the certificate is issued and CloudFront has finished deploying:

1. Create only the Route 53 zone first, using a targeted Terraform plan for
   `aws_route53_zone.arithmoslayer` during this bootstrap.
2. Request a temporary ACM DNS-validated certificate in `us-east-1` for the
   new apex and `www` hostnames. Copy its validation CNAMEs into the
   existing GoDaddy DNS zone, leaving forwarding and nameservers unchanged.
   ACM validation tokens are reusable for the same account and hostname,
   so they also validate the Terraform-managed replacement certificate.
   Do not target replacement of the existing certificate alone: the old
   certificate must remain attached until CloudFront is updated.
3. Once ACM validation succeeds, review and apply the infrastructure plan
   using the current production billing variables, not their disabled
   defaults. Wait for CloudFront deployment and verify both new hostnames
   against CloudFront before switching DNS.
   Delete the temporary certificate once the Terraform-managed certificate
   is issued; retain the validation CNAMEs for automatic renewal.
4. Allow the new domain in the Cloudflare Turnstile widget configuration
   before public cutover. Preserve any existing email/verification DNS
   records if added at GoDaddy.
5. Set GoDaddy's nameservers to the `arithmoslayer_nameservers` output.
   Verify HTTPS, API health, registration, and payment return links.

Initially all three hostnames serve the same deployment without redirecting
the old hostname. Application-generated email and payment links still use
`ffm.derschweigert.de` until a separate canonical-domain cutover; keep that
hostname and existing Stripe webhooks operational.
