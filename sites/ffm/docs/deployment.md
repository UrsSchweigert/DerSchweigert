# Arithmo Slayer: deployment and URL routing

Part of the [Arithmo Slayer system documentation](../README.md). How the site, API and promo pages are deployed, the CI IAM permissions every new AWS resource needs, and how URLs are routed.

## Deployment shape

The dedicated FFM stack now exists under `infra/terraform/sites/ffm/`.

- Static site: shared `static_site` Terraform module
- API: shared `api_backend` Terraform module
- Lambda function name: `ffm-api`
- DynamoDB tables:
  - `ffm-users`
  - `ffm-scores`
  - `ffm-ratelimits` (flask-limiter's `dynamodb://` storage backend; see `app/ratelimit_storage.py`)
- SES: `aws_ses_domain_identity`/`aws_ses_domain_dkim` for `ffm.derschweigert.de`, verified via Route53 TXT/CNAME records that Terraform manages directly (using the existing `data.aws_route53_zone.primary`); the Lambda role gets a scoped `ses:SendEmail`/`ses:SendRawEmail` inline policy (`ffm-lambda-ses-access`) limited to that domain identity's ARN. **SES is sandboxed on this AWS account** — domain verification lets the Lambda *send*, but real end users won't receive mail until AWS approves production access. A production-access request has already been filed (`aws sesv2 put-account-details --production-access-enabled`, submitted 2026-09-05, `TRANSACTIONAL` mail type); poll `aws sesv2 get-account --query 'Details.ReviewDetails.Status'` for its current status.
- SES monitoring/alerting: `aws_ses_configuration_set.ffm_transactional` + a CloudWatch event destination track Send/Bounce/Complaint/Reject counts; `aws_cloudwatch_metric_alarm.ffm_ses_bounce`/`ffm_ses_complaint`/`ffm_ses_send_volume` notify the `ffm-alerts` SNS topic (email subscription — **requires a one-time click on AWS's confirmation email** before it actually delivers). See "Email-abuse resistance (SES)" above for thresholds/rationale.
- Anti-abuse CAPTCHA: Cloudflare Turnstile on `register`/`forgot-password`/`resend-verification`. Its secret key lives in Secrets Manager (`ffm/turnstile-secret-key`, created directly via `aws secretsmanager create-secret`, **not** Terraform-managed since the value originates externally at Cloudflare) and is resolved into the Lambda's environment at cold start via `TURNSTILE_SECRET_KEY_ARN`, mirroring the JWT secret's `_resolve_secret_key()` pattern.
- JWT signing key: Secrets Manager secret `ffm/jwt-secret-key`, passed to the Lambda as `SECRET_KEY_ARN` and resolved at cold start in `lambda/handler.py`
- Terraform backend key: `ffm/prod/terraform.tfstate`
- CI deploy flow is in `.github/workflows/deploy.yml`

The deploy workflow currently:

1. runs FFM backend tests (`test-ffm` job, gates both PRs and pushes to `main`)
2. `terraform apply`s `infra/terraform/sites/ffm/` — provisions/updates DynamoDB tables, the Secrets Manager secret, IAM policies, the CloudFront response-headers policy, and the Lambda's environment variables
3. builds a dependency-bundled Lambda zip into `sites/ffm/ffm-lambda.zip` and pushes it with `aws lambda update-function-code`
4. syncs `sites/ffm/static/` to the site bucket
5. invalidates CloudFront
6. smoke-tests `/` and `/api/health`

**Which merges deploy:** a push to `main` only deploys the sites its own diff touches, and a change that touches
nothing under `sites/ffm/` (or `infra/terraform/sites/ffm/`, or the shared `infra/` modules) — a docs-only or CI-only
merge, say — deploys nothing at all here. That is fine as long as every `main` run gets to finish, which is why
`deploy.yml` makes `main` runs queue instead of cancelling each other (`cancel-in-progress` only applies to pull
requests). If a `deploy-ffm` run fails or is cancelled anyway, its commit's changes stay undelivered until the next
merge that touches `sites/ffm/`; to deliver them immediately, re-run the workflow from the Actions UI
(`workflow_dispatch` on `main`, which treats every site as changed).

**Known trade-off in step 2→3:** Terraform's own `archive_file` data source (in the shared `api_backend` module) only zips `sites/ffm/lambda/` (just `handler.py`) — it does not bundle `app/` or pip dependencies, because those need Lambda-compatible (`manylinux2014`) wheels that Terraform can't easily produce. So `terraform apply` in step 2 briefly deploys that thin, non-functional zip as the Lambda's code before step 3 overwrites it with the real, fully-bundled one moments later in the same job. In practice this means a deploy has a short window (well under a minute) where a live request could hit `ModuleNotFoundError` before step 3 completes. Acceptable for this project's traffic level, but if it ever needs to become a non-issue, the fix is to build the dependency-bundled directory *before* running `terraform apply` and point `lambda_source_dir` at that pre-built directory instead of `sites/ffm/lambda/`, then drop the separate `update-function-code` step entirely so Terraform is the single source of truth for both code and config.

### CI's AWS IAM permissions are NOT managed in this repo — read this before adding new AWS resource types

CI authenticates to AWS as IAM user `derschweigert-ci-deploy` (account `113725432218`). Its permissions come entirely from a customer-managed IAM policy, **`derschweigert-deploy-scope`, which is hand-maintained directly in AWS IAM and has no Terraform resource anywhere in this repo.** Nothing in `infra/terraform/` grants or documents these permissions, and there's no automated check that the policy covers what a given `.tf` file actually needs.

This was discovered the hard way on 2026-09-05: `deploy-ffm` had *never* run `terraform apply` before that date (it only rebuilt/pushed the Lambda zip). The moment a `terraform apply` step was added, it failed immediately — the CI user had no DynamoDB permissions at all for `ffm-users`/`ffm-scores`, tables that had existed for a while already. That's strong evidence the entire FFM Terraform stack had only ever been applied from someone's personal/broad local AWS credentials, never from CI.

**If you add a new AWS resource type to any `infra/terraform/sites/*` config that CI applies, assume the CI policy does not yet grant the permissions it needs, and check/update it before relying on a green CI run to mean the infra actually got created.** Concretely:

```bash
# Inspect current policy
aws iam get-policy --policy-arn arn:aws:iam::113725432218:policy/derschweigert-deploy-scope
aws iam get-policy-version --policy-arn arn:aws:iam::113725432218:policy/derschweigert-deploy-scope \
  --version-id <DefaultVersionId> --query 'PolicyVersion.Document'

# Update: edit the fetched document, then push a new version and make it default
aws iam create-policy-version --policy-arn arn:aws:iam::113725432218:policy/derschweigert-deploy-scope \
  --policy-document file://updated-policy.json --set-as-default
```

Customer-managed policies cap out at **5 versions** — once at capacity, `aws iam delete-policy-version --policy-arn ... --version-id vN` an old non-default one first. Also: newly-added permissions can take a minute or two to propagate; if a freshly-granted action still gets `AccessDenied` immediately after updating the policy, wait ~2 minutes and retry before assuming the policy edit was wrong (observed directly during this rollout: a `secretsmanager:GetSecretValue` read-back failed once right after being granted, then succeeded on retry with no further changes).

The policy is currently at **v17** (2026-10-19); v18 is written up below and applied when the dev environment is first deployed. Its historical versions added the following permissions beyond the original derschweigert/ffm S3+CloudFront+API-Gateway+Lambda+ACM+Route53 scope:
- `FfmDynamoDbTables` — full lifecycle (`CreateTable`/`DescribeTable`/`UpdateTable`/`DeleteTable`/TTL/tags, plus `DescribeContinuousBackups`/`DescribeTableReplicaAutoScaling`/`DescribeKinesisStreamingDestination`, all of which the AWS provider's table-refresh calls even though nothing in this repo's config uses backups/replicas/streams) scoped to `ffm-users`, `ffm-scores`, `ffm-ratelimits`.
- `FfmJwtSecretManage` — full lifecycle including `CreateSecret`/`PutSecretValue`/`GetSecretValue` (the provider reads a secret version back right after creating it, to populate Terraform state) scoped to `ffm/jwt-secret-key`.
- `CloudFrontAll` extended with `CreateResponseHeadersPolicy`/`UpdateResponseHeadersPolicy`/`DeleteResponseHeadersPolicy` — needed by **both** sites now that they share a response-headers-policy resource in the `static_site` module.
- `IamRoleForLambda` extended with `PutRolePolicy`/`DeleteRolePolicy` (inline role policies aren't covered by the existing `iam:Get*`/`iam:List*` wildcards) for both `ffm-lambda-role` and `derschweigert-lambda-role`.
- `FfmSesManage` (added 2026-09-05 for the email-verification feature) — `ses:VerifyDomainIdentity`/`DeleteIdentity`/`GetIdentityVerificationAttributes`/`VerifyDomainDkim`/`GetIdentityDkimAttributes`/`SetIdentityDkimEnabled` on `Resource: "*"` (SES v1 identity-management APIs don't support resource-level ARN scoping the way `ses:SendEmail` does). `Route53All`/`IamRoleForLambda` already covered the Route53 records and Lambda inline-policy needs, so no other statement changes were required. This statement grants no send capability itself — sending is authorized separately via the Lambda role's own `ffm-lambda-ses-access` inline policy (created by Terraform, scoped to the domain identity ARN).
- `FfmTurnstileSecretRead` (added 2026-09-05 for CAPTCHA, `GetResourcePolicy` added in v11) — `secretsmanager:DescribeSecret`/`ListTagsForResource`/`GetResourcePolicy` scoped to `ffm/turnstile-secret-key-*`, letting Terraform's metadata-only `data "aws_secretsmanager_secret" "turnstile_secret"` resolve the ARN. **`GetResourcePolicy` was missed in the initial v10 statement and broke `deploy-ffm`'s first CI run** (`AccessDeniedException` on `secretsmanager:GetResourcePolicy` while reading the data source) — the data source apparently calls this in addition to `DescribeSecret`/`ListTagsForResource`, same as the JWT secret's provider read-back already needed it (see `FfmJwtSecretManage`, which already had it from the start). Deliberately still **no** `GetSecretValue` here — the CI principal never needs to read the actual secret value, only the Lambda role does (via `secret_arns` in `module.api`, a separate, already-covered grant).
- `FfmSesConfigurationSetManage` (added 2026-09-05 for the SES bounce/complaint/volume alarms) — `ses:CreateConfigurationSet`/`DeleteConfigurationSet`/`DescribeConfigurationSet`/`CreateConfigurationSetEventDestination`/`UpdateConfigurationSetEventDestination`/`DeleteConfigurationSetEventDestination` on `Resource: "*"` (same SES v1 no-ARN-scoping limitation as `FfmSesManage`).
- `FfmAlertsSnsManage` / `FfmAlertsCloudWatchAlarms` (added 2026-09-05, same rollout) — SNS topic/subscription management scoped to `arn:...:sns:eu-central-1:113725432218:ffm-alerts`, and CloudWatch alarm management scoped to `arn:...:cloudwatch:eu-central-1:113725432218:alarm:ffm-ses-*`.
- **v12 (2026-09-06, `email_forwarding` module for `info@derschweigert.de`):** `S3ReadOnly`/`S3Manage`'s four separate `derschweigert-terraform-state`/`derschweigert-site-*` resource entries were consolidated into a single `arn:aws:s3:::derschweigert-*` (+ `/*`) wildcard — both to fit the new `derschweigert-de-ses-incoming` bucket under the existing statements without adding entries (the policy document was already close to IAM's 6,144-character customer-managed-policy size cap) and because "derschweigert-" is already this account's real bucket-naming convention. `S3Manage` gained `s3:PutLifecycleConfiguration`. `IamRoleForLambda` and `LambdaManage` each gained one resource ARN for the new `derschweigert-de-ses-forwarder-role`/`derschweigert-de-ses-forwarder` function. A new `FfmSesReceiptManage` statement grants `ses:*Receipt*` on `Resource: "*"` (SES receipt-rule-set/rule/active-rule-set APIs, like the other SES v1 identity APIs above, don't support resource-level ARN scoping) — deliberately a substring wildcard rather than enumerating all ~9 individual `Create`/`Delete`/`Describe`/`List`/`Set`/`Reorder`-prefixed action names, again to stay under the size cap. Freed a version slot by deleting `v7`.

Freeing a version slot (the policy sits at the 5-version cap) was done by deleting the then-oldest version each time — `v4` before pushing `v9`, then `v5` before pushing `v10`, then `v7` before pushing `v12`, then `v8` before pushing `v13`, `v11` before pushing `v16`, and `v12` before pushing `v17`.

- **v13 (2026-10-16, log-group retention import + daily retention-cleanup EventBridge rule):** `infra/terraform/modules/api_backend/main.tf` now also manages `aws_cloudwatch_log_group.api` (`/aws/lambda/<app_name>-api`, 30-day retention) for both `ffm-api` and `derschweigert-api`, imported via each site's top-level `import` block rather than created fresh (both groups were already auto-created by Lambda on first invoke). This needed a new `ApiLambdaLogGroups` statement — `logs:*LogGroup*`/`logs:PutRetentionPolicy`/`logs:*Tag*` scoped to `arn:aws:logs:eu-central-1:113725432218:log-group:/aws/lambda/*-api:*` (substring/prefix wildcards covering `Create`/`Delete`/`Describe`LogGroup(s) and `Tag`/`Untag`/`ListTagsFor`Resource respectively, needed for both the `import` refresh and ordinary apply). `infra/terraform/sites/ffm/main.tf` also adds `aws_cloudwatch_event_rule.retention_cleanup` + `aws_cloudwatch_event_target.retention_cleanup` + `aws_lambda_permission.retention_cleanup`, wiring a daily EventBridge trigger straight to the existing `ffm-api` Lambda (see "Data retention" above) — `lambda:AddPermission` was already covered by the existing `LambdaManage` statement's `ffm-api` resource entry, but a new `FfmRetentionRule` statement was needed for `events:*Rule`/`events:*Target*`/`events:*Tag*` scoped to `arn:aws:events:eu-central-1:113725432218:rule/ffm-retention-cleanup`. Adding these two statements verbatim would have pushed the document past the 6,144-character cap, so this version also shortened several existing statements' `Sid`s (purely cosmetic, e.g. `GitHubContactSecretMetadata` → `GitHubContactSecret`, `IamRoleForLambda` → `IamLambdaRole`; no `Action`/`Resource`/`Effect` changed) and consolidated the `secretsmanager:{List,Un}?Tag*Resource`/`dynamodb:{List,Un}?Tag*Resource` triples already present in `GitHubContactSecret`/`FfmJwtSecret`/`FfmDynamoDb` into the same `*Tag*` substring-wildcard pattern already used by `FfmSesReceiptManage`. No existing grant was narrowed, widened beyond the same action set, or removed — same permissions, more compact syntax. **This policy update has been applied and verified** (`aws iam get-policy` confirms `DefaultVersionId: v13`); it is a prerequisite for this session's `terraform apply`, not a substitute for it.
- **v16 (2026-10-19, `lesen.derschweigert.de` static site):** corrected the CloudFront Origin Access Identity action names to `cloudfront:*CloudFrontOriginAccessIdentity`, replacing the outdated `CreateOriginAccessIdentity`/`UpdateOriginAccessIdentity`/`DeleteOriginAccessIdentity` entries. The action was verified with the IAM policy simulator for OAI create/update/delete. The site bucket uses the `derschweigert-lesen-site-*` prefix so it remains within the existing `derschweigert-*` S3 resource scope; no broader S3 permissions were added. Removed the oldest non-default version (`v11`) to make room under IAM's five-version limit.
- **v17 (2026-10-19, `lesen.derschweigert.de` static site):** added `s3:PutBucketTagging` to the existing `S3Mgr` scope after Terraform was denied while applying the site's bucket tags. The resource remains limited to the existing `derschweigert-*` S3 bucket/object ARNs. The deployment job detects and clears the taint from the earlier partial bucket creation before retrying, so it does not need broader `s3:DeleteBucket` access. Removed the oldest non-default version (`v12`) to make room under IAM's five-version limit.

- **v18 (2026-11-19, `ffm-dev.derschweigert.de` dev environment):** swapped exact `ffm`/prod names for patterns so one entry covers prod and dev, which also kept the document under the 6,144-character cap (5,984): S3 `ffm-site-*` to `ffm*-site-*`, Lambda `function:ffm-api` to `function:ffm*-api`, IAM role `ffm-lambda-role` to `ffm*-lambda-role`, the three `ffm-` DynamoDB tables to `table/ffm-*` (this also covers `ffm-visits`), and the JWT secret `ffm/jwt-secret-key-*` to `ffm*/jwt-secret-key-*`. Every pattern still matches the old exact name, so prod is unaffected. Simulated with `aws iam simulate-custom-policy` before applying. **Apply this before the first dev run**, otherwise the apply creates the `*`-scoped resources (DNS, ACM, SES, CloudFront functions) and is then denied on the bucket, Lambda, role, tables and secret, leaving a half-built stack.

**Recommendation, not yet done:** bring `derschweigert-deploy-scope` under Terraform management so this can't silently drift out of sync again. Skipped in the 2026-09-05 session to avoid widening the blast radius of an already-eventful production deploy.

## Dev environment (ffm-dev.derschweigert.de)

A second, independent copy of the stack. Every merge to `main` that touches ffm is deployed here, not to production, so dev shows what the next release would ship. Production is released by hand: Actions tab -> "Sites: deploy to production" -> Run workflow on `main` (leave `sites` on `ffm`). That run tests ffm and deploys whatever `main` holds, including the production Terraform. A branch can also be tried here before it is merged. Terraform: `infra/terraform/sites/ffm-dev/` (own state key `ffm/dev/terraform.tfstate`); deploy: the manual workflow `.github/workflows/deploy-ffm-dev.yml`.

- **No extra hosted zone.** `ffm-dev.derschweigert.de` is a record in the existing `derschweigert.de` zone that prod uses. The `static_site` module writes the ACM validation and alias records there, as it does for prod. A zone would only be needed to hand the name to other nameservers.
- **Own everything else:** S3 bucket `ffm-dev-site-<account>`, CloudFront, API Gateway, Lambda `ffm-dev-api`, DynamoDB tables `ffm-dev-{users,scores,ratelimits,visits}`, JWT secret `ffm-dev/jwt-secret-key` (a dev token never validates on prod), SES identity for `ffm-dev.derschweigert.de`. Left out on purpose: `arithmoslayer.de`, the SES alarms, the retention cron, and Stripe (billing flags are pinned to false, so dev can take no payment).
- **Deploying a branch:** Actions tab -> "ffm: deploy to dev" -> Run workflow -> choose the branch. The next merge to `main` replaces it. The `infra` box skips Terraform for a faster code-only redeploy. It never starts from a pull request, because the repository is public and the job holds AWS credentials; a pull-request trigger would run a stranger's code with them. Only a dispatch by hand or `deploy.yml`'s push-to-`main` job starts it. `tests/test_dev_deploy_workflow.py` enforces that, and that the S3 sync excludes stay identical to `deploy-ffm`'s.
- **CORS** follows `APP_BASE_URL` (`app/__init__.py`), so each environment answers only its own origin.
- **Turnstile is shared with prod:** dev uses the same widget and secret (`ffm/turnstile-secret-key`). Add `ffm-dev.derschweigert.de` to that widget's hostname list in the Cloudflare dashboard once, or the CAPTCHA fails on dev. This cannot be done from Terraform, because the key's value originates at Cloudflare.
- **Mail:** dev sends from `no-reply@ffm-dev.derschweigert.de` through its own SES identity. The account has SES production access (eu-central-1), so dev mail reaches any address. Bounce and complaint rates are counted per account, so a dev build that mails bad addresses can get sending paused for prod too: register with your own address on dev.
- **Not indexed, not secret:** the deploy writes a `robots.txt` that disallows everything, and there is no password (a decision, not an omission). The hostname becomes public through Certificate Transparency logs as soon as ACM issues its certificate, so `robots.txt` is the only barrier.
- **Left out, and what that means:** no retention cron, so addresses registered on dev are never purged (`behavior.md` "Data retention" does not apply there). Delete test accounts yourself.
- **Cost:** about $0.40 a month (the JWT secret in Secrets Manager); the rest is pay-per-request or free (ACM), and the API Gateway ceiling is 10 requests/s.
- **First run:** leave the `infra` box ticked. A code-only redeploy has no bucket to upload to until Terraform has created the stack once.
- **Trust:** the job runs whatever branch you dispatch with the same AWS credentials as the production deploy. Dispatch only branches whose changes you have read.

## Promotional landing page and URL routing

`/` no longer serves the game directly: it serves the promotional landing page
that lives in `sites/ffm/static/promo/`. The game keeps its old file path and
is reachable at `/play`.

URL map in production (all three aliases — `ffm.derschweigert.de`,
`arithmoslayer.de`, `www.arithmoslayer.de` — share one distribution):

| Request | Served |
| --- | --- |
| `/` | `promo/index.html` (promotional landing page) |
| `/promo`, `/promo/` | `promo/index.html` |
| `/beta`, `/beta/` | `beta/index.html` (open-beta invite page) |
| `/beta/index.html` | `beta/index.html` (direct, unchanged) |
| `/play` | `index.html` (the game) |
| `/play/` | 301 redirect to `/play` (the game's assets are relative) |
| `/index.html` | `index.html` (unchanged; the mobile/legacy entry point) |
| everything else (assets, legal pages, `/api/*`, `/unlock*`) | unchanged |

The promo page sits in its own `sites/ffm/static/promo/` directory rather than
at the bucket root because `static/index.html` must stay exactly where it is:
the Capacitor bundler (`sites/ffm/mobile/scripts/copy-assets.mjs`) and the six
mobile test files copy and assert that path. A separate directory also keeps
the promo page's CSS/JS/tests together without touching the game bundle.

**Routing is done by a CloudFront Function, not by the bucket.** The S3 origin
has no directory-index support and the distribution has no 403/404 rewrite, so
without the function `/play`, `/promo/` and `/beta/` all return 403.
`default_root_object = "index.html"` only covers the bare `/` request, which is
why it is kept: if the function is ever detached, `/` falls back to the game
instead of failing. The function is
`infra/terraform/sites/ffm/cloudfront/landing-rewrite.js`, wired in through
`module "site"`'s `viewer_request_function_code`; the module attaches it to the
default cache behavior only, so the `/api/*` and `/unlock*` behaviors are
untouched.

Two routing details are easy to get wrong:

- **`/play/` is a 301 to `/play`, not a rewrite.** The game shell
  (`static/index.html`) references its assets relatively (`styles.css`,
  `game/main.js`, `favicon.png`, …), so serving it at `/play/` would make the
  browser request `/play/styles.css` and friends, which the bucket does not
  have (403). At `/play` the relative paths resolve to the bucket root and
  work, so the function answers `/play/` with a `301 Moved Permanently` and
  `Location: /play` instead of rewriting it.
- **The promo page's assets are referenced root-absolutely (`/promo/promo.css`,
  `/promo/promo.js`, `/promo/og-image.png`, …).** `/` and `/promo/` are
  rewritten to `/promo/index.html` internally, but the browser URL stays `/`,
  so relative asset paths would resolve to `/promo.css` and 404. The absolute
  prefix is what makes the same HTML work at `/`, `/promo` and `/promo/`
  without a redirect.

**A Terraform change is required for `/play` to work.** The `deploy-ffm` job's
`sites/ffm/static/` → bucket sync only uploads files and cannot create a
CloudFront Function. A static-only deploy therefore uploads `promo/` but leaves
the current URL behaviour in place until the job's `terraform apply` has run
and CloudFront has finished deploying the function.

Local preview (the rewrites do not exist on a plain static server, so open the
files directly):

```bash
cd sites/ffm/static && python3 -m http.server
# http://localhost:8000/promo/index.html   -> promo page
# http://localhost:8000/index.html         -> game
```

CI coverage: `test-ffm` runs `node --test sites/ffm/static/promo/*.test.js`,
and `deploy-ffm`'s smoke test asserts that `/` serves the promo page
(`id="promo-root"` plus `promo.css`), that `/promo/`, `/promo/promo.css`,
`/promo/promo.js`, `/play`, `/index.html` and `/game/main.js` return 200, that
`/play/` returns 301 with `Location: /play`, and that `/play`'s body loads
`game/main.js`. If the promo page's root marker is ever renamed, update that
smoke-test grep in the same change. The dev-only promo files (`promo/tools/*`,
`promo/README.md`) are excluded from the bucket sync and deleted from the
bucket by the `aws s3 rm` cleanup in the same step.
