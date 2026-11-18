---
description: >
  Phase 6 LEAD — CI/CD wiring.
  You are the LEAD agent (Sonnet). This phase has a single worker task.
  Read the existing workflow, write a precise worker micro-brief, spawn one Haiku worker
  to add the deploy-ffm job. Then review the YAML diff yourself: verify no existing jobs
  were modified, secrets match, paths filter is correct. Validate YAML syntax.
tools:
  - read_file
  - run_in_terminal
  - replace_string_in_file
  - runSubagent
---

# Phase 6 Lead — CI/CD

## Your responsibilities

1. Read `.github/workflows/deploy.yml` in full (every line).
2. Read `game-build-state.json` (S3 bucket name, Lambda function name).
3. Dispatch one Haiku worker with a micro-brief specifying exact YAML to add.
4. After the worker: read the modified file. Personally verify the review criteria below.
5. Run `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/deploy.yml'))"` — must exit 0.
6. Run `grep -q 'deploy-ffm' .github/workflows/deploy.yml` — must exit 0.
7. Report `SUCCESS` or `FAILED:<reason>`.

---

## Worker task decomposition

### Worker 1 — Add deploy-ffm job (single worker)

Your micro-brief to the worker must include:
- The **exact indentation level and YAML style** of the existing jobs (copy it verbatim as context)
- The job name: `deploy-ffm`
- `needs: []` (runs in parallel with derschweigert job)
- `if:` condition scoped to `paths` containing `sites/ffm/**` or `infra/terraform/sites/ffm/**`
  (match the pattern the existing job uses, if any — otherwise use a `paths-filter` action)
- The 8 steps in order from the spec, with exact shell commands (include literal S3 bucket
  name from `game-build-state.json`, literal Lambda function name `ffm-api`, region `eu-central-1`)
- The worker must use `replace_string_in_file` to append the job — it must NOT rewrite the
  whole file (preserves the existing job exactly)

---

## Review criteria (lead checks personally)

- [ ] Existing `deploy-derschweigert` job is byte-for-byte unchanged
- [ ] `deploy-ffm` job is valid YAML at the correct indentation level
- [ ] `paths` filter references `sites/ffm/**` and `infra/terraform/sites/ffm/**`
- [ ] All 8 steps are present and in order
- [ ] Secrets used match exactly what the existing job uses (no new secret names invented)
- [ ] S3 sync separates `index.html` (no-cache) from other assets (long cache)
- [ ] CloudFront invalidation uses `--paths "/*"`


- `ffm-math-game.prompt.md` — "Deployment Notes" section

## Goal

Add a `deploy-ffm` job to `.github/workflows/deploy.yml` that mirrors the existing
derschweigert deploy job but targets the FFM site's resources.

## Requirements

### Trigger

The job must only run when changes are pushed to `main` AND the diff touches files under:
- `sites/ffm/**`
- `infra/terraform/sites/ffm/**`

Use a `paths` filter on the job (or a path filter on the workflow trigger if no per-job
path filter is already in use — match the existing pattern).

### Job steps (in order)

1. **Checkout** — same as existing job
2. **Configure AWS credentials** — same secrets as existing job
3. **Run tests** — `pytest sites/ffm/tests/ -q --tb=short` (fail fast)
4. **Build Lambda zip**:
   ```bash
   cd sites/ffm
   pip install -r requirements.txt -t build/
   cp -r app lambda build/
   cd build && zip -r ../ffm-lambda.zip . && cd ..
   ```
5. **Update Lambda function code**:
   ```bash
   aws lambda update-function-code \
     --function-name ffm-api \
     --zip-file fileb://sites/ffm/ffm-lambda.zip \
     --region eu-central-1
   ```
6. **Sync static assets to S3**:
   ```bash
   aws s3 sync sites/ffm/static/ \
     s3://ffm-site-${{ secrets.AWS_ACCOUNT_ID }}/ \
     --delete \
     --cache-control "public, max-age=31536000" \
     --exclude "index.html"
   # index.html gets no-cache so deploys are instant
   aws s3 cp sites/ffm/static/index.html \
     s3://ffm-site-${{ secrets.AWS_ACCOUNT_ID }}/index.html \
     --cache-control "no-cache, no-store, must-revalidate"
   ```
7. **Invalidate CloudFront cache**:
   ```bash
   DIST_ID=$(aws cloudfront list-distributions \
     --query "DistributionList.Items[?contains(Aliases.Items,'ffm.derschweigert.de')].Id | [0]" \
     --output text)
   aws cloudfront create-invalidation --distribution-id "$DIST_ID" --paths "/*"
   ```
8. **Smoke test**:
   ```bash
   sleep 10
   curl -sf https://ffm.derschweigert.de/ > /dev/null
   curl -sf https://ffm.derschweigert.de/api/health | grep '"ok":true'
   ```

### Secrets required

Use the same secrets already configured for the derschweigert job. Do NOT add new secrets;
`AWS_ACCOUNT_ID` must already exist (check the existing job; if it doesn't, note it in a
comment and add it to the list of secrets the user must configure).

## Constraints

- DO NOT modify the existing `deploy-derschweigert` job
- DO NOT change the workflow trigger — only add the new job
- The new job must have `needs: []` (no dependency on the derschweigert job — they can run
  in parallel)
- Match indentation and YAML style exactly as the existing file uses

## Done when

`grep -q 'deploy-ffm' .github/workflows/deploy.yml` exits 0 and the YAML is valid
(`python3 -c "import yaml; yaml.safe_load(open('.github/workflows/deploy.yml'))"` exits 0).
