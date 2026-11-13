# Public-repo hardening: what is done, and what only the owner can do

Status when written: the repo was still **private** (`gh api` reported `visibility: private`).
The Copilot agent's token can read rulesets but gets **HTTP 403** on repo settings, Actions
permissions, branch protection, secrets and visibility, so those need the owner.

## Done in this PR

| Item | Detail |
| --- | --- |
| Licence | PolyForm Strict 1.0.0 (`LICENSE`), `NOTICE` with third-party carve-out |
| Hardcoded PINs removed | derschweigert admin PIN and landhauscheck stats PIN come from the `DERSCHWEIGERT_ADMIN_PIN` secret; code fails closed when unset |
| Leaked API keys | Google Maps, HERE Transit and Tankerkönig keys redacted from the recorded fixtures; the recorder redacts `key`, `apikey`, `api_key` and `token` params; `tests/test_fixtures_carry_no_credentials.py` fails if one is committed again |
| Fork-safe waste review | `waste-calendar-review.yml` now only acts on same-repo PRs, so a public fork cannot reuse a `waste/*` branch name to reach a `contents: write` job |
| Dependabot | `.github/dependabot.yml` (Actions, pip, lesen npm; monthly) |

Already fine (verified): every workflow sets least-privilege `permissions:`; `deploy` runs only on
`refs/heads/main`; no `pull_request_target`/`workflow_run`; `main` ruleset blocks deletion and
force-push and requires the `test` and `test-ffm` checks; `CODEOWNERS` exists.

## Only you can do these (Settings, web UI or `gh` with an admin token)

**Before making it public**
1. Create the secret: `gh secret set DERSCHWEIGERT_ADMIN_PIN --repo UrsSchweigert/DerSchweigert`.
2. Revoke or rotate every key that ever appeared in the repository — the Google Maps, HERE Transit and
   Tankerkönig keys in the recorded fixtures, and any other credential named below. Redacting a file
   does not remove it from history. Keep the Google key restricted by referrer/API only as a second
   line of defence, not as the fix.
3. Decide on rewriting history (`git filter-repo`) for the AWS account ID, email and street address in
   history. Rotating is the less disruptive option.
4. Change visibility: Settings -> General -> Danger zone -> Change visibility.

**Actions (Settings -> Actions -> General)**
- Fork pull request workflows: **Require approval for all outside collaborators**.
- Keep **Send secrets to workflows from fork pull requests** off.
- Workflow permissions: **Read repository contents** by default; leave "Allow GitHub Actions to create
  and approve pull requests" off unless `refresh-stations`/waste flows need it.
- Allow actions: **Allow owner, and select non-owner actions** (GitHub-authored, plus those you use).
- Never attach self-hosted runners to the public repo.

**Contributions (Settings -> General / Moderation)**
- Interaction limits: restrict to collaborators / prior contributors (max 6 months, renewable).
- Disable Issues, Projects and Discussions you do not want public (Wiki is already off).
- Collaborators: keep the list minimal; no one else can push.

**Rulesets (Settings -> Rules)**
- On `main`, raise `required_approving_review_count` above 0 and enable `require_code_owner_review`
  if you want outside PRs to need your review. With a count of 0 any collaborator can merge a green PR.
- Add `deploy`-relevant checks you consider mandatory.
- Add a bypass actor only for yourself if you need to override.

**Deploy safety**
- Create an Environment (e.g. `production`) with **required reviewers** and reference it from the
  deploy jobs, so deploys wait for your approval. (A `copilot` environment already exists.)
- Move AWS credentials from repo secrets into that environment's secrets.

**Code security (Settings -> Code security)**
- Enable secret scanning and **push protection**, Dependabot alerts and security updates,
  private vulnerability reporting, and CodeQL default setup.
- Keep `swift` out of default setup: the Capacitor iOS projects resolve their SwiftPM packages from
  `node_modules`, so CodeQL autobuild fails on them. [codeql-swift.yml](../.github/workflows/codeql-swift.yml)
  runs the Swift analysis with manual build steps instead, on merges to `main` and weekly.
- Enable **Require signed commits** on the `main` ruleset if you want it.

**Accounts**
- Enforce 2FA on your account; review authorised OAuth apps and personal access tokens.
- Confirm the Copilot plan terms for public repositories.

## Limits that cannot be removed
- A public repo cannot hide code from anyone, and forks and clones are irrevocable.
- Forking of a public repo cannot be disabled; the licence is only a legal deterrent.
