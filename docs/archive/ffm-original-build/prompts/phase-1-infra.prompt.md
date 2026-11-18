---
description: >
  Phase 1 LEAD — Terraform infrastructure for ffm.derschweigert.de.
  You are the LEAD agent. Read the spec, decompose into worker tasks, spawn Haiku workers,
  review their output, and validate. You write no Terraform yourself.
tools:
  - read_file
  - list_dir
  - grep_search
  - file_search
  - run_in_terminal
  - replace_string_in_file
  - runSubagent
---

# Phase 1 Lead — Terraform Infrastructure

## Your responsibilities

1. Read `ffm-math-game.prompt.md` (Deployment Notes section) and all files under
   `infra/terraform/modules/` and `infra/terraform/sites/derschweigert/` to understand
   the existing patterns before issuing any worker briefs.
2. Decompose into the four worker tasks below.
3. After each worker completes, read every file it produced and verify it against
   the review criteria listed.
4. If a file is wrong, issue a targeted fix brief to a new Haiku worker (max 2 rounds).
5. Run `terraform -chdir=infra/terraform/sites/ffm validate` and
   `terraform -chdir=infra/terraform/sites/ffm init -backend=false` — both must exit 0.
6. Report `SUCCESS` or `FAILED:<reason>`.

---

## Worker task decomposition

### Worker 1 — Backend config files
**Files:** `infra/terraform/sites/ffm/backend.tf`, `infra/terraform/sites/ffm/variables.tf`

Micro-brief must specify:
- `backend.tf`: S3 backend, bucket `derschweigert-terraform-state`,
  key `ffm/prod/terraform.tfstate`, region `eu-central-1`,
  dynamodb_table `derschweigert-terraform-locks`
- `variables.tf`: `aws_account_id` (string), `aws_region` (string, default `eu-central-1`),
  `domain_name` (string, default `ffm.derschweigert.de`),
  `route53_zone_id` (string, default `Z02407051JK3BF2C58UEQ`)
- Mirror variable naming from `infra/terraform/sites/derschweigert/variables.tf` exactly

### Worker 2 — Static site resources
**Files:** partial `infra/terraform/sites/ffm/main.tf` (S3 + CloudFront + ACM only)

Micro-brief must specify:
- Provider block with alias `aws.us_east_1` for `us-east-1` (ACM requirement)
- `module "static_site"` calling `../../modules/static_site` — pass exact module inputs
  learned from reading the module's `variables.tf`
- ACM cert resource for `ffm.derschweigert.de` in `us-east-1`
- CloudFront custom error response: 403 → `/index.html`, 200; 404 → `/index.html`, 200
- CloudFront ordered cache behaviour for `/api/*`: `cache_policy_id` = disabled,
  all headers + cookies forwarded, `allowed_methods = ["DELETE","GET","HEAD","OPTIONS","PATCH","POST","PUT"]`

### Worker 3 — API + data resources
**Files:** append to `infra/terraform/sites/ffm/main.tf` (API GW + Lambda + DynamoDB + Route53)

Micro-brief must specify:
- `module "api_backend"` calling `../../modules/api_backend` — pass exact module inputs
  learned from reading that module's `variables.tf`; function_name = `ffm-api`
- Two `aws_dynamodb_table` resources: `ffm-users` and `ffm-scores`, both with
  `hash_key = "pk"` (String), `range_key = "sk"` (String), `billing_mode = "PAY_PER_REQUEST"`
- `aws_route53_record` A and AAAA alias records pointing to the CloudFront distribution
  in zone `var.route53_zone_id`

### Worker 4 — Outputs
**File:** `infra/terraform/sites/ffm/outputs.tf`

Micro-brief must specify: output the CloudFront distribution ID, S3 bucket name,
API Gateway invoke URL, and Lambda function ARN. Mirror naming from
`infra/terraform/sites/derschweigert/outputs.tf`.

---

## Review criteria (check after each worker)

- No resource touches `infra/terraform/sites/derschweigert/`
- No `aws_route53_zone` resource (must use data source or variable only)
- ACM cert uses `provider = aws.us_east_1`
- CloudFront `/api/*` behaviour has caching fully disabled
- DynamoDB tables use `PAY_PER_REQUEST`
- All module calls reference `../../modules/` (relative path, not registry)


## Context you must read first

Read these files before writing any Terraform:
- `infra/terraform/modules/static_site/main.tf` — understand module inputs/outputs
- `infra/terraform/modules/api_backend/main.tf` — understand module inputs/outputs
- `infra/terraform/sites/derschweigert/main.tf` — the reference implementation to mirror
- `infra/terraform/sites/derschweigert/variables.tf` — variable patterns to reuse
- `game-build-state.json` — project context

## Goal

Create `infra/terraform/sites/ffm/` with a complete, self-contained Terraform stack for
`ffm.derschweigert.de`. It must be independent — no resources shared with the derschweigert
stack except the Route53 hosted zone (referenced by ID, never recreated).

## Required resources

### S3
- Bucket name: `ffm-site-${var.aws_account_id}`
- Private (no public access), versioning enabled, OAC access only (no legacy OAI)

### ACM Certificate
- Domain: `ffm.derschweigert.de`
- Must be created in `us-east-1` using a provider alias `aws.us_east_1`
- DNS validation via Route53 zone `Z02407051JK3BF2C58UEQ`

### CloudFront distribution
- Default cache behaviour: OAC → S3 bucket (serves `index.html` + `/game/*`)
- Additional cache behaviour `/api/*`: forward to API Gateway origin, no caching
  (`default_ttl = 0`, `max_ttl = 0`, `min_ttl = 0`, all headers/cookies forwarded)
- Default root object: `index.html`
- Custom error response: 403/404 → `/index.html` (SPA fallback)
- Aliases: `ffm.derschweigert.de`
- ACM cert: the one created above

### API Gateway + Lambda
- Lambda function name: `ffm-api`
- Use the `api_backend` module; point at `sites/ffm/lambda/`
- Stage name: `prod`
- Integration: Lambda proxy

### DynamoDB
- Table `ffm-users`: partition key `pk` (String), sort key `sk` (String), PAY_PER_REQUEST
- Table `ffm-scores`: partition key `pk` (String), sort key `sk` (String), PAY_PER_REQUEST
- Region: `eu-central-1`

### Route53
- A and AAAA alias records for `ffm.derschweigert.de` → CloudFront distribution
- Use data source to reference zone `Z02407051JK3BF2C58UEQ` (do NOT create a new zone)

## Files to create

- `infra/terraform/sites/ffm/main.tf`
- `infra/terraform/sites/ffm/variables.tf`
- `infra/terraform/sites/ffm/outputs.tf`
- `infra/terraform/sites/ffm/backend.tf` (S3 backend, key `ffm/prod/terraform.tfstate`,
  same bucket/lock-table as derschweigert: `derschweigert-terraform-state` /
  `derschweigert-terraform-locks`)

## Constraints

- DO NOT modify anything under `infra/terraform/sites/derschweigert/`
- DO NOT modify shared modules unless a bug prevents reuse (add a note if so)
- Run `terraform -chdir=infra/terraform/sites/ffm init -backend=false` and
  `terraform -chdir=infra/terraform/sites/ffm validate` — both must exit 0

## Done when

`terraform -chdir=infra/terraform/sites/ffm plan` shows a valid plan (may show resources
to add; must show 0 resources to destroy in the derschweigert stack).
