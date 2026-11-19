# ffm-dev.derschweigert.de: infrastructure

The dev copy of the [`ffm`](../ffm/) stack. Same modules, same CloudFront rewrites, same CSP; its own
state (`ffm/dev/terraform.tfstate`) and its own `ffm-dev-*` resources, so applying it cannot touch prod.

**No hosted zone is created.** The hostname is a record in the existing `derschweigert.de` zone
(`route53_zone_id` in `terraform.tfvars` is the same ID prod uses). Do not add an
`aws_route53_zone` here.

Deploy it from the Actions tab: "ffm: deploy to dev (manual)". Everything else (what is left out, the
Turnstile hostname step, mail behaviour) is in
[`sites/ffm/docs/deployment.md`](../../../../sites/ffm/docs/deployment.md#dev-environment-ffm-devderschweigertde).

Plan it locally (read-only):

```
terraform -chdir=infra/terraform/sites/ffm-dev init -reconfigure
terraform -chdir=infra/terraform/sites/ffm-dev plan -lock=false
```

No `TF_VAR_*` are needed: dev has no Stripe, no admin token from GitHub, and no account-ID variable.
