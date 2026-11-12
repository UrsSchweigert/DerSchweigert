# Lesen and Buchstabenzeit hosting

This stack owns two independent `static_site` module instances in the existing
`lesen/prod/terraform.tfstate` state:

| Module | Host | Bundle | Terraform outputs |
| --- | --- | --- | --- |
| `site` (unchanged) | `lesen.derschweigert.de` | `sites/lesen/static/` | `site_bucket`, `cloudfront_distribution_id`, `cloudfront_domain_name` |
| `marketing` | `buchstabenzeit.derschweigert.de` | `sites/lesen/marketing/` | `marketing_site_bucket`, `marketing_cloudfront_distribution_id`, `marketing_cloudfront_domain_name` |

Each module creates its own bucket, certificate, CloudFront distribution and DNS
aliases. Marketing is not an alias or subdirectory of the app. Its bundle is
uploaded to its own bucket root, with `index.html` as the default root object.
The marketing CSP allows images and fonts hosted at the existing app origin.
The deployment also copies these existing app assets into the marketing bucket,
so marketing HTML can use same-origin relative URLs without cross-origin font
headers or any change to the app:

- `images/buchstabenzeit-logo.png`
- `favicon.png`
- `fonts/grundschrift-regular.woff2`
- `fonts/grundschrift-bold.woff2`
- `fonts/grundschrift-LICENSE.txt` (font licence)

The `deploy-lesen` job in `.github/workflows/deploy.yml` provisions both modules,
uploads each bundle to its own bucket and invalidates each distribution. The
marketing invalidation completes before its exact HTTPS root URL is smoke-tested;
the existing app deployment and smoke test remain intact. Changes to either
bundle or this stack trigger this job and the lesen tests.

Offline regression check (no AWS calls):

```sh
node --test sites/lesen/tests/marketing-deployment.test.mjs
terraform -chdir=infra/terraform/sites/lesen fmt -check
```
