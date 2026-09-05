# ffm.derschweigert.de — infrastructure

`ffm.derschweigert.de` now has its own dedicated Terraform stack in this
folder.

The stack currently provisions:

- `../../modules/static_site` for the static game frontend (includes a
  CloudFront response-headers policy for security headers)
- `../../modules/api_backend` for the Flask `/api/*` backend
- DynamoDB tables `ffm-users`, `ffm-scores`, and `ffm-ratelimits` (rate-limit
  counters; see `sites/ffm/app/ratelimit_storage.py`)
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
