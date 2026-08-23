# ffm.derschweigert.de — infrastructure

This site has no dedicated infrastructure yet. The `ffm.derschweigert.de` DNS
record and TLS certificate are currently managed as an alias inside
[`infra/terraform/sites/derschweigert`](../derschweigert/main.tf), piggybacking
on that CloudFront distribution.

Once the "Final Fantasy Math" game has real application content under
[`sites/ffm`](../../../../sites/ffm), stand up its own stack here using the
shared modules:

- `../../modules/static_site` for S3 + CloudFront + ACM + Route53
- `../../modules/api_backend` for an optional Lambda/API Gateway backend

At that point, remove the `ffm.derschweigert.de` alias from the derschweigert
stack and point Route53 at this stack's own CloudFront distribution instead.
