# ffm.derschweigert.de — infrastructure

`ffm.derschweigert.de` now has its own dedicated Terraform stack in this
folder.

The stack currently provisions:

- `../../modules/static_site` for the static game frontend
- `../../modules/api_backend` for the Flask `/api/*` backend
- DynamoDB tables `ffm-users` and `ffm-scores`

Key files:

- `main.tf` — stack wiring
- `backend.tf` — remote Terraform state key (`ffm/prod/terraform.tfstate`)
- `variables.tf` — region/domain/zone inputs
- `outputs.tf` — CloudFront/API/Lambda outputs

For the application-level system overview, see
[`sites/ffm/README.md`](../../../../sites/ffm/README.md).
