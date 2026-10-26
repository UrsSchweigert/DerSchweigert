---
title: Harness Decisions
description: Stage 1 output recording the stack, runtime, isolation tier, capability matrix, and policy overrides for the incremental development harness
ms.date: 2026-10-26
---

## Overview

Produced by Stage 1 of `setup-project-harness`. Later stages read this file instead of asking again. Status is **chosen** (user answered) or **assumed** (spec default).

## Requirement Source

* `uploads/20261026_improvements`: web and Android requirements for lesen.derschweigert.de (items 1.1 to 3.3). Not implemented during setup.

## Repository Findings

* Monorepo: `sites/derschweigert` (FastAPI, pytest), `sites/ffm` (static game, Flask API, pytest, `node --test`), `sites/lesen` (static reading app in `static/`, Capacitor Android shell, `node --test tests/*.test.mjs`), `infra/terraform`.
* Validation commands: `pytest -q` (root, targets `sites/derschweigert/tests`), `SECRET_KEY=ci-test-key pytest sites/ffm/tests/ -q`, `node --test sites/ffm/static/game/*.test.js`, and in `sites/lesen`: `npm test`. CI: `.github/workflows/deploy.yml`, `android-release.yml`. No lint configuration found.
* `sites/lesen/www/` holds a copy of `static/` produced by `npm run copy-assets` (plus duplicate `* 3.*` files). Requirements apply to the shared source `sites/lesen/static/`.
* Existing agent customizations to reuse: `.github/agents/android-*.agent.md` (orchestrator, planner, implementer, executor, reviewer), `.github/skills/android-phase-a-entry`, `.github/prompts/game/`, `sites/lesen/ANDROID-PLAN.md`.
* GitHub: no issues, no milestones. One Project exists (`@UrsSchweigert's untitled project`), readable since `gh auth refresh -s read:project` on 2026-10-26.
* Working tree has unrelated uncommitted changes (a deleted `android-phase-a.prompt.md`, untracked harness docs). Stage 1 touches only `docs/harness/decisions.md`.

## Decisions

| Decision                | Value                                                                                           | Status  |
|-------------------------|-------------------------------------------------------------------------------------------------|---------|
| Harness language        | Python 3, standard library plus `sqlite3`, tested with the existing pytest                      | chosen  |
| Harness location        | `tools/harness/` with tests in `tools/harness/tests/`. Needs a `pytest.ini` testpaths addition in Stage 2 | chosen/assumed |
| Agent runtime           | GitHub Copilot CLI 1.0.103, installed and authenticated (headless `copilot -p` smoke test returned OK on 2026-10-26). Stage 4 builds the adapter. Workers run it inside the Tier A sandbox with a Copilot-only token | chosen  |
| Model tiers             | `low` = Claude Haiku, `standard` = Claude Sonnet, `strong` = Claude Opus. Exact model IDs are resolved from the CLI in Stage 4. If routing is unavailable, report "model routing unavailable" | chosen  |
| Isolation tier          | **Tier A** since Stage 3.5 (Docker worker sandbox, signed attestation, 24 h validity, image-bound). Falls back to Tier B automatically when the attestation is missing, expired, forged, or the image changed | chosen  |
| Approval mechanism      | Local terminal confirmation by the repository owner, signed record (spec default)                | assumed |
| State store             | SQLite at `~/.local/state/derschweigert-harness/` (outside worker-writable paths)                | assumed |
| Notification channel    | Terminal plus GitHub issue mention                                                              | chosen  |
| Merge policy            | Autonomous merge per spec default, only when all merge gates pass and no escalation path is touched. GitHub branch protection is unavailable on the free plan, so it is applied by convention (see Branch Protection by Convention). Autonomous merge is possible only while Tier A is attested | chosen  |
| Blender for assets      | Wanted. Blender 5.2.3 is now installed, so procedural assets run through the headless runner (`blender --background --factory-startup`). Human tasks remain the fallback | chosen  |
| Asset sources / licenses| Existing repo assets, CC0 (Poly Haven), procedural scripts. CC0 only. Paid generation budget 0   | assumed |
| Budgets, concurrency    | Spec defaults                                                                                   | assumed |
| Protected paths         | `tools/harness/`, `docs/harness/`, `.github/`, `infra/`, workflows, approval records. `.github/CODEOWNERS` added (advisory, not enforced) | assumed |

## Capability Matrix

| Capability                              | Detected | Evidence                                                                 | Consequence if absent / action                                           |
|-----------------------------------------|----------|--------------------------------------------------------------------------|--------------------------------------------------------------------------|
| Headless agent runtime                  | Yes      | `copilot` 1.0.103 at `/opt/homebrew/bin`, logged in, `copilot -p` returned OK | None. `run` still gated by isolation tier                           |
| Subagent support and model routing      | Likely   | CLI offers `--model` and `--agent`. Custom agents exist in `.github/agents` | Confirm model IDs in Stage 4. Else single-model fallback               |
| VS Code hook contracts                  | No       | `code` not on PATH, no `.github/hooks`                                   | Use thin entry points only. No hook reliance                             |
| `gh` auth, scopes, permissions          | Yes      | Logged in as repo owner, scopes `gist read:org read:project repo workflow`, admin on repo | None |
| GitHub Projects                         | Yes      | `has_projects: true`, `gh project list` returns 1 project, probe reports available | Sync does not write Project fields yet. Issue labels and links carry the state until it does |
| Native sub-issues and dependencies      | Sub-issues: yes (schema) | Stage 3 probe: GraphQL `Mutation.addSubIssue` exists. Mutation itself never called. Dependencies not probed | Sync uses native sub-issues when the schema has them, otherwise explicit links. Phase dependencies are explicit links |
| Branch protection and merge queue       | No       | HTTP 403: private repo on a free plan                                    | Cannot be enforced. Applied by convention, reported as a standing limitation |
| CODEOWNERS                              | Yes (advisory) | `.github/CODEOWNERS` assigns every path to the owner               | GitHub does not require the review without branch protection. Convention only |
| Container / devcontainer / separate account | Yes     | Docker 29.2.1. Image `harness-worker:1` (node 22, Copilot CLI 1.0.103). Probe passes 12 of 12 checks | Container egress is not restricted (known limit) |
| Notification channel                    | Yes      | Terminal and GitHub mentions via `gh`                                    | None                                                                     |
| Blender                                 | Yes      | `/opt/homebrew/bin/blender`, version 5.2.3 LTS (found during the Stage 5 probe)  | Headless runner verified with a real cube export that passed asset validation |
| `uv`                                    | No       | missing                                                                  | Only needed for the MCP server. The headless runner does not use it      |
| MCP for Blender server entry            | Yes      | An entry mentioning Blender exists in a client config. The addon socket on `localhost:9876` accepted a connection (nothing was sent) | The MCP chain is not used. `get_addon_status` cannot be called by the harness. That socket is unauthenticated: close the addon server when it is not needed |
| Python, Node, sqlite3                   | Yes      | `/usr/bin/python3`, `/usr/local/bin/node`, `/usr/bin/sqlite3`            | None                                                                     |

## Stage 3 Probe Result (read-only, 2026-10-26)

Command: `PYTHONPATH=tools python3 -m harness probe`. Findings for `UrsSchweigert/DerSchweigert`: private, issues enabled, admin permission, token scopes `gist read:org repo workflow` at probe time (Projects then unavailable; after the scope refresh the probe reports available), branch protection and rulesets unavailable (free plan), native sub-issues present in the GraphQL schema. A dry-run `sync` of the fixture plan printed five intended creates and mutated nothing (0 issues and 0 milestones afterwards).

## Branch Protection by Convention

GitHub cannot enforce protection on this repository, so the harness and the owner follow these rules. They are enforced only by trusted harness code, never by GitHub, and a human with admin rights can still bypass them.

* Nothing is pushed to `main`. Workers push only to branches named `harness/<issue>-<slug>`, never with force. The broker rejects any other target.
* Every change reaches `main` through a pull request. The harness merges only when every merge gate passes (head-bound checks and independent review, no stale evidence, no escalation path touched).
* Changes to escalation paths and to `tools/harness/`, `docs/harness/` and `.github/` are never merged autonomously. They need a human task, and a worker diff touching the harness paths is rejected outright.
* `.github/CODEOWNERS` records the owner for every path as documentation of intent.
* The human owner follows the same flow and avoids pushing directly to `main` or force-pushing.
* `status` reports "branch protection: by convention only" so the gap stays visible.
* Upgrading the plan or making the repository public would turn these into enforced rules. The probe detects that automatically.

## Investigator pass (added after Stage 5, 2026-10-26)

* `harness investigate` automates the investigator role: real Copilot CLI in the Tier A sandbox, interactive questions (or `--non-interactive` plus `--answers`), code-side validation, and a report. It never approves or writes to GitHub.
* Deliberate deviation from the default role mapping: the investigator starts on `standard` instead of `low`, because drafting a whole plan is not a small bounded task and one approval rests on it. A rejected draft moves up a tier on evidence. `--tier low` restores the default.
* Escalation matching now also matches by file name for entries without a directory, so `sites/lesen/package.json` counts as `package.json`. Before this, nested dependency manifests would have bypassed the escalation rule. `build.gradle`, `settings.gradle` and `AndroidManifest.xml` (Android build and permissions) were added to the default escalation paths.
* Adapter fix found by the live test: the CLI refused to read `/work/task.json` for some models because it lies outside the starting directory. Workers now run with `--allow-all-paths`, which is safe only because the container is the boundary.
* `--feedback` / `--feedback-file` revise an existing draft: the investigator receives the current draft and the owner's accumulated feedback, which overrides its earlier assumptions. The replaced draft is archived under `history/rev-N/`, and an invalid revision never replaces the current draft.
* Verified live: the real investigator produced a plan for a small throwaway app that passed all validation rules, and then revised it according to feedback.

## Fixes found before the first real run (2026-10-26)

* Role mapping changed by the owner on 2026-10-26: implementers start on `low` (Haiku) and reviewers on `standard` (Sonnet), instead of the spec default of `standard` for both. Failed checks or review findings still escalate an implementer one tier. The mapping is in code (`models.ROLE_TIER`), not in the approval digest, so it applies to the approved plan without re-approval.
* `run --dry-run` used to mark real issues Done and could complete the real plan, so a rehearsal consumed the run. It now runs on a throwaway copy of the store (`rehearsal-<time>/`, kept for inspection) and never touches the real state.
* A merge never advanced the harness's own copy of `main`. Later issues built on a base without earlier work, and post-merge checks ran on stale code. A real merge now fetches `main` from the remote into the clone, and a rehearsal merge fast-forwards the throwaway clone.
* Known limit: the harness only merges through its own publisher. If a human merges a harness PR on GitHub, the scheduler does not notice. A `human-merges` policy therefore stops at review and needs the issue to be closed another way.
* Known side effect: this repository deploys to production when `main` changes (`deploy.yml`), so every autonomous merge of a `sites/lesen` change publishes it.

## Stage 5: Human Tasks, Monitoring, and Delivery (built 2026-10-26)

* Human tasks (`decision`, `asset`, `manual_test`) carry the reason, request, response format, resolution criteria, options, owner, secondary owner, and deadline. They block dependent issues (manual tests do not block an issue that is In Review). Notifications are deduplicated per task round and survive restarts. Reminders: after 24 h, at most 3. Escalation to the secondary owner at 72 h. Silence changes nothing.
* Responses come only from `python3 -m harness respond` (identity from the OS account and the authenticated `gh` login) or an authenticated GitHub interaction passed in by trusted code. Impostors, bots, and untrusted sources cannot move a task. GitHub comments are notifications only. Credential-like content in a response is refused.
* Manual GUI tests follow a validation policy (`manual_testing.allowed_reasons`), name the exact head, are bound to it, and become stale when the head moves. A pass adds evidence but never replaces automated checks. A fail returns the issue for repair. Inconclusive stays open.
* Assets: policy added to the plan (`assets`, covered by the approval digest). Source order: repository, CC0 library, procedural, AI. CC0 library search and AI generation are not available (no MCP chain, no provider), so those steps record why and fall through. Deterministic validation covers format, size, triangles, bounding box, texture size, license, attribution, checksum, absolute paths, embedded scripts, and credentials. Failing twice, no allowed source, or no Blender raises an asset task. Manifest: `assets/manifest.json` with scripts in `assets/scripts/`.
* The Blender runner is headless and host-side. Scripts are screened (a blocklist, so only defense in depth) and run with a scrubbed environment and `--factory-startup`. Blender is not inside the Docker sandbox, so a malicious script that passes the screen would run with your privileges. Treat procedural scripts from workers as untrusted until reviewed, or leave `procedural` out of `allowed_sources`.
* Telemetry: sanitized structured events with plan, phase, issue, attempt, and run ids, kept 14 days and pruned on every pass. `status` and `status --json` show phases, requirement coverage, queue, blockers, workers, runner health, expired leases, pending sync, failures, evidence, human tasks, budgets, and metrics. Tokens, cost, and generation credits are labeled unavailable.
* A dashboard was not built. `status` is the monitoring interface.

## Stage 4: Scheduler and Runtime Adapter (built 2026-10-26)

* Adapter: `CopilotCliAdapter` runs the real Copilot CLI 1.0.103 in the Tier A sandbox (`--allow-all-tools --no-ask-user --silent`), one container per attempt, killed by name on cancel or timeout. Verified live: `HARNESS_LIVE=1 python3 -m pytest tools/harness/tests/test_harness_live.py` ran a real implementer task, and trusted code fetched the branch, inspected it with `GitRepo`, and ran the check in the sandbox.
* Models (probed, the CLI has no listing command): `low` = `claude-haiku-4.5`, `standard` = `claude-sonnet-5`, `strong` = `claude-opus-5` then `claude-opus-4.8`. Models that the CLI rejected: `claude-sonnet-4.5`, `claude-sonnet-4.6`, `claude-opus-4.5`, `gpt-5.4`. Only one model per low and standard tier is available, so the independent reviewer of a standard implementer runs on the next tier up. The attempt records say so. Model availability is cached for 24 hours in `models.json`.
* Usage per role and tier is unavailable: the harness runs the CLI in silent mode and gets no usage data. `status` labels it.
* Trusted git: workers push nothing. Their branches are fetched into a bare clone owned by the harness (`trusted-clone.git`), and every inspection, patch-id, rebase and export runs there with hooks, system config and global config disabled.
* Remote publishing (`GitHubPublisher`: push `harness/*` branches without force, open one PR, merge bound to the reviewed commit SHA) is implemented but has only been exercised against a local remote and a test double. It has not run against live GitHub.
* Not automated: creating implementation issues from phases (the investigator pass). `import-issues` accepts refined issues, validated against the approved plan. `run` refuses when no issues exist.
* Checks run in the worker image, which has no pytest or project dependencies. Validation commands that need more must be runnable there, or the image must be extended and re-verified.

## Tier A Isolation (Stage 3.5, built 2026-10-26)

* Sandbox: Docker image `harness-worker:1` built from `tools/harness/worker/Dockerfile`. Launcher flags: non-root uid 10001, read-only root filesystem, all capabilities dropped, `no-new-privileges`, memory, CPU and PID limits, one read-write bind mount of the task directory, tmpfs for `/tmp` and the home directory, no Docker socket.
* Worker directories live under `~/.local/share/derschweigert-harness-work/`, apart from the store. The store, approval key, broker token, and `gh` login are never mounted.
* Credentials: the broker reads `broker.token` (`GH_NEW_TOKEN`, a classic PAT with broad scopes, chosen by the owner) from `~/.local/state/derschweigert-harness/` with mode 0600. Workers receive only `copilot.token` (fine-grained PAT, Copilot Requests permission, no repository access, expires 2026-11-25) as `COPILOT_GITHUB_TOKEN`. It reaches the container through the docker client's environment, not its arguments.
* Verification: `python3 -m harness isolation verify` launches the real container with host canaries (`GH_TOKEN`, `SSH_AUTH_SOCK`, a store path) and checks 12 guarantees. Only a fully passing probe writes a signed attestation. `detect_isolation` returns Tier A only for a valid, fresh attestation whose image id still matches.
* Verified on this machine: the Copilot CLI ran inside the sandbox with only the Copilot token, created a file in the task directory, and could not see the store, `gh`, or any host credential.
* Known limits: egress is unrestricted, so a worker can reach the network and could exfiltrate the task directory or the Copilot-only token. Anything with the same OS user can still change the attestation key, so the attestation is evidence of the last probe and is not tamper-proof against the operator. The broker token is broader than the harness needs. Docker Desktop's VM is the isolation boundary.
* Rotation: renew `copilot.token` before 2026-11-25. Rebuild the image and rerun `isolation verify` after any Dockerfile change.

## Consequences

* When the attestation lapses the harness drops to Tier B: only `plan`, `approve` on a fixture, `status`, and `--dry-run` operations are permitted.
* Remaining steps for a useful `run` on the real plan: produce refined implementation issues (investigator pass), then `import-issues`. Optionally restrict container egress.
* The requirements file contains no requirement IDs for the Android channel beyond a shared scope statement, so the Stage 2 planner must map each item to the web app, Android, or both.

## Next Invocation

`/setup-project-harness stage=2 requirements=/Users/ursschweigert/Documents/GitHub/DerSchweigert/uploads/20261026_improvements`
