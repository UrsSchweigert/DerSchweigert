---
title: Harness Decisions
description: Stage 1 output recording the stack, runtime, isolation tier, capability matrix, and policy overrides for the incremental development harness
ms.date: 2026-10-28
---

## Overview

Produced by Stage 1 of `setup-project-harness`. Later stages read this file instead of asking again. Status is **chosen** (user answered) or **assumed** (spec default).

## Delegated Model Selection (2026-10-28)

The owner's choice supersedes the fixed role-to-tier mapping for newly
investigated tasks. Historical role assignments below remain the compatibility
fallback for existing imported issues without model choices.

* The investigator acts as the delegating agent. It receives the probed, approved model menu and implementation budget, then chooses a concrete model and a task-specific cost/quality reason for implementation, refinement, and review.
* Model tiers remain policy cost bands and repair-escalation limits, not mandatory role assignments. A difficult task may start with a more capable implementer; a straightforward review may use a cheaper independent model.
* Strict schemas and trusted code validate model IDs, availability, reasons, independent review, and the strong implementation-attempt budget. Choices cannot change authorized operations, approved paths, check gates, or merge policy.
* Failed checks and review findings retain bounded evidence-based repair escalation. Infrastructure retries retain any previous justified upgrade. If a repair or a delegator retry moves the implementer onto the originally selected reviewer model, independent review is rerouted and recorded. A delegator retry spends no repair budget, so reviewer independence is checked against the implementer model in use rather than against the repair counter.
* `harness start` is a guided wrapper over the existing commands, not a new execution path: it reuses `investigate`, `plan`, `approve`, `import-issues`, `run`, and `gui`, asks before every irreversible step, and infers the pending steps from the store so a rerun resumes. It never approves for the owner; the digest is still typed in a real terminal, and a non-interactive stdin stops with instructions instead of guessing.
* The owner selects the model sources the picker may draw from with `--model-source` on `investigate` and `plan` (`copilot`, `deepseek`, `local`; repeatable and combinable, default `copilot`). The policy records the sources and the derived tier menu, so the approval digest covers the menu, and `harness models` shows which candidate ids this runtime accepts. A store-level `model_catalog.json` can replace a source/tier list when a runtime uses other ids; it is read when a plan is built and never alters an approved plan. The dashboard shows the catalog and probes it on demand; probing runs only when the owner clicks, one probe at a time, at most once a minute, and is refused in `--read-only` mode, because it spends a sandboxed runtime call per candidate.
* Planning reports and attempt records preserve the choices and reasons. Selection is part of the existing planning pass, without another routing-agent call for every worker. Measured model quality is unavailable; cost categories are qualitative policy estimates, and token figures are estimates (see Cancelling, splits, and usage estimates below).
* An implementer's `blocked` outcome, or a `done` outcome that still lists blockers, is recorded as a reported failure (`worker_blocked`). It is never published, checked, or merged, and it spends no repair budget. Before this change the implementer's outcome and blockers were ignored, so a worker that said it could not finish could still reach Done if checks and review passed.
* A stuck report triggers one read-only consultation of the delegating agent (`delegator_consults_per_issue`, default 1, part of the approved budgets). It returns `retry` with optional guidance and model choice, or `ask_owner` with a diagnosis. Trusted code validates model, availability, reason, credentials, and the strong-attempt budget, and a failed or unusable consultation becomes the existing owner decision task without spending repair budget. The delegator only recommends a split. The strong analysis below proposes a validated one, and the owner can apply it.
* Plans approved before this change have no consultation or analysis budget, so stuck reports go straight to the owner. Failed checks and review findings do not trigger a consultation.
* A strong-tier `analyst` (read-only, `analyses_per_issue`, default 1, absent budgets count as zero) studies a stuck issue after the delegating agent chooses `ask_owner` or after a second stuck report. It reports a root cause and recommends `split`, `retry`, or `needs_owner`. Split proposals are validated by trusted code (requirement coverage, new ids, path allowlist or existing anchors, command deny list, sibling dependencies, no cycles, no credentials) and saved for `import-issues` under `analyses/` in the private store.
* The analysis is advice until the owner acts: it does not restart work, spend repair budget, or change any issue. The analysis is skipped without budget, an approved available strong model, or model routing.

## Dashboard planning and approval (2026-10-29)

* The dashboard takes a requirements Markdown file from draft to an approved plan: it extracts and edits the requirements, runs `investigate`, `plan`, and `import-issues` as fixed non-interactive preparation jobs, and never starts a live run by itself. Those jobs run the existing commands; the dashboard adds no execution path of its own.
* Approval is no longer terminal-only. The terminal stays the default and the strongest: the digest prefix is typed into the process that signs the record. The dashboard path exists because the owner asked for it, and is permitted only with current Tier A, the loopback, session-token, and same-origin checks, a plan version and digest bound to the reviewed copy, a reviewed draft that still matches the plan phases and the preflight and issue digests, no pending investigator questions, and a hand-typed 12-character digest prefix. It writes the same signed scope-and-policy record.
* Accepted residual risk: the session token reaches the browser, so the dashboard path authenticates a browser session rather than a distinct human. An approval that must not be delegable stays with terminal `approve`.
* Dashboard sandbox verification runs `isolation verify` as a maintenance job and signs the same attestation, so an expired attestation can be refreshed without a terminal. It works in Tier B because that verification is what establishes Tier A.

## Cancelling, splits, and usage estimates (2026-10-28)

* Issues gain a terminal `Cancelled` state, reachable from `Refining`, `Ready`, and `Blocked`. Before this, cancelling only set a flag and left the issue `Blocked`, so its phase never completed and its dependents waited silently until the wall-clock budget paused the run. Cancelling now also cancels every issue that depends on the cancelled one, because those issues can no longer run, and cancels their open tasks. A cancel recorded before this change is settled on the next scheduling pass.
* A phase whose issues are all `Done` or `Cancelled`, but whose requirements are not all covered by a `Done` issue, pauses the plan with the uncovered requirements named. The owner imports issues that cover them and resumes. Before this, such a phase flapped between `Active` and `Validating` on every pass while the plan stayed `Executing`.
* A decision task whose issue has a validated proposed split gains a sixth option, `apply the proposed split`. Choosing it only records the approval. The scheduler then validates the proposal again against the current state, creates the parts (resumable after an interruption), rewires dependents to all parts, and cancels the original with `superseded_by`. A proposal that no longer validates returns to the owner as a new task. Parts carry the analyst's per-part model choices, validated like planning choices, and not the original's.
* The spec's "never estimate usage" is replaced by: record estimates, name the source, never enforce them. Each attempt keeps the agent's own `usage_estimate`, a size-based lower bound from the prompt, task, and result files, and any output lines that mention usage (stored, not parsed, because the format is unverified and the agent writes to the same stream). Totals by plan, model, and role appear in `status`, `issue`, and the dashboard. Cost is shown only from an owner-written `model-prices.json`, because the harness cannot know prices and Copilot may bill by request rather than by token.
* Not verified against the real runtime: Docker was not running and the store had no `copilot.token` on 2026-10-28, so no worker could start. Opt-in live tests for the stuck report, the delegator decision, and the strong analysis were added and print the runtime's real usage output; they have not been run.
* Existing imported issues and running coordinators are not rewritten. Model routing unavailable remains an explicit fallback. This change uses offline tests and does not run paid agents, change the production store, approve a plan, or contact GitHub.

## Security hardening (2026-10-27)

These decisions supersede the earlier convention-only merge and blocklist-only
host-script policies. Historical capability probes below have not been rerun
against production during this change.

* Broker and scheduler mutations share signed-operation authorization, including worker lease fencing where applicable. A signature does not grant operations absent from its permission list.
* Asset IDs are path-free, and outputs, manifests, scripts, repository assets, and human uploads reject traversal and symlink escapes. Host-side Blender refuses scripts that trusted code has not explicitly reviewed and allowlisted exactly; unreviewed requests use human assets instead.
* Checks bind to actual head/base ancestry, not saved labels. Remote base refreshes precede validation and integration. Clean unchanged-patch rebases can retain review, but must rerun checks.
* Autonomous merges require readable effective branch rules and classic protection where configured, including strict required checks, a pull-request rule, and no blocking approval requirement. Unreadable rules fail closed and blockers name the rule. An exact reviewed SHA and a truthful merge API result are required. No GitHub settings are changed automatically.
* All four check stages use persisted start/poll/cancel jobs with separate ownership tokens and leases. Implementation leases remain live during checks. Revision changes invalidate pending results; pause, cancellation, timeout, and restart clean up named containers and cannot turn abandoned work into a pass.
* Generated validation commands are preflighted in the checker image before approval. Configuration errors stop without implementation repairs; repeated unchanged check failures are circuit-broken, and human retries retain cumulative budgets unless the operator explicitly extends one.
* External completion can be reconciled only from verified GitHub PR, merge, CI, and review data, with operator attribution and normal state transitions. Missing review evidence is not fabricated.
* Verification uses offline regressions, temporary Git remotes, and real local subprocesses. Live GitHub protection, Docker cleanup, and Blender execution have not been revalidated for this change. Production runs and GitHub settings were not altered.

Follow the [upgrade procedure](../../tools/harness/README.md#upgrading-safely)
before resuming existing work. Changing signed permissions requires a new
approved plan version, not an in-place policy edit.

## Requirement Source

* `uploads/20261026_improvements`: web and Android requirements for lesen.derschweigert.de (items 1.1 to 3.3). Not implemented during setup.

## Repository Findings

* Monorepo: `sites/derschweigert` (FastAPI, pytest), `sites/ffm` (static game, Flask API, pytest, `node --test`), `sites/lesen` (static reading app in `static/`, Capacitor Android shell, `node --test tests/*.test.mjs`), `infra/terraform`.
* Validation commands: `pytest -q` (root, targets `sites/derschweigert/tests`), `SECRET_KEY=ci-test-key pytest sites/ffm/tests/ -q`, `node --test sites/ffm/static/game/*.test.js`, and in `sites/lesen`: `npm test`. CI: `.github/workflows/deploy.yml`, `buchstabenzeit-release.yml`. No lint configuration found.
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
| Approval mechanism      | Terminal confirmation by the repository owner is the default. The dashboard may approve a reviewed plan with a hand-typed 12-character digest prefix under current Tier A, version/digest binding, and the same signed record. Residual risk: the browser session token authenticates a session, not a distinct human | chosen |
| State store             | SQLite at `~/.local/state/derschweigert-harness/` (outside worker-writable paths)                | assumed |
| Notification channel    | Terminal plus GitHub issue mention                                                              | chosen  |
| Merge policy            | Autonomous merge only when all gates pass, Tier A is attested, and strict server-side required checks are verified. The historical free-plan protection gap now blocks autonomous merging | chosen  |
| Blender for assets      | Wanted. Headless host execution requires an exact trusted script-review allowlist. Human asset tasks remain the default for unreviewed procedural requests | chosen  |
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
| Branch protection and merge queue       | No       | Historical probe: HTTP 403, private repo on a free plan                   | Autonomous merge is blocked until strict required checks can be verified |
| CODEOWNERS                              | Yes (advisory) | `.github/CODEOWNERS` assigns every path to the owner               | GitHub does not require the review without branch protection. Convention only |
| Container / devcontainer / separate account | Yes     | Docker 29.2.1. Image `harness-worker:1` (node 22, Copilot CLI 1.0.103). Probe passes 12 of 12 checks | Container egress is not restricted (known limit) |
| Notification channel                    | Yes      | Terminal and GitHub mentions via `gh`                                    | None                                                                     |
| Blender                                 | Yes      | `/opt/homebrew/bin/blender`, version 5.2.3 LTS (found during the Stage 5 probe)  | Headless runner verified with a real cube export that passed asset validation |
| `uv`                                    | No       | missing                                                                  | Only needed for the MCP server. The headless runner does not use it      |
| MCP for Blender server entry            | Yes      | An entry mentioning Blender exists in a client config. The addon socket on `localhost:9876` accepted a connection (nothing was sent) | The MCP chain is not used. `get_addon_status` cannot be called by the harness. That socket is unauthenticated: close the addon server when it is not needed |
| Python, Node, sqlite3                   | Yes      | `/usr/bin/python3`, `/usr/local/bin/node`, `/usr/bin/sqlite3`            | None                                                                     |

## Stage 3 Probe Result (read-only, 2026-10-26)

Command: `PYTHONPATH=tools python3 -m harness probe`. Findings for `UrsSchweigert/DerSchweigert`: private, issues enabled, admin permission, token scopes `gist read:org repo workflow` at probe time (Projects then unavailable; after the scope refresh the probe reports available), branch protection and rulesets unavailable (free plan), native sub-issues present in the GraphQL schema. A dry-run `sync` of the fixture plan printed five intended creates and mutated nothing (0 issues and 0 milestones afterwards).

## Server-enforced merge precondition

The 2026-10-26 implementation allowed convention-only protection because the
repository's plan returned HTTP 403 for protection settings. That exemption was
removed on 2026-10-27: fetching the latest base alone cannot prevent an external
merge between the final fetch and the merge API call.

The publisher now requires strict required status checks enforced for
administrators, plus at least one configured required check. If protection is
unavailable or unreadable, autonomous merging stops with a decision task. An
owner must provide a verifiable protection configuration before retrying; the
harness does not change subscription plans, repository visibility, or rules.
Scope, review, escalation-path, and exact-head checks remain mandatory.

## Investigator pass (added after Stage 5, 2026-10-26)

* `harness investigate` automates the investigator role: real Copilot CLI in the Tier A sandbox, interactive questions (or `--non-interactive` plus `--answers`), code-side validation, and a report. It never approves or writes to GitHub.
* Deliberate deviation from the default role mapping: the investigator starts on `standard` instead of `low`, because drafting a whole plan is not a small bounded task and one approval rests on it. A rejected draft moves up a tier on evidence. `--tier low` restores the default.
* Escalation matching now also matches by file name for entries without a directory, so `sites/lesen/package.json` counts as `package.json`. Before this, nested dependency manifests would have bypassed the escalation rule. `build.gradle`, `settings.gradle` and `AndroidManifest.xml` (Android build and permissions) were added to the default escalation paths.
* Adapter fix found by the live test: the CLI refused to read `/work/task.json` for some models because it lies outside the starting directory. Workers now run with `--allow-all-paths`, which is safe only because the container is the boundary.
* `--feedback` / `--feedback-file` revise an existing draft: the investigator receives the current draft and the owner's accumulated feedback, which overrides its earlier assumptions. The replaced draft is archived under `history/rev-N/`, and an invalid revision never replaces the current draft.
* Verified live: the real investigator produced a plan for a small throwaway app that passed all validation rules, and then revised it according to feedback.

## Fixes found before the first real run (2026-10-26)

* Role mapping changed by the owner on 2026-10-26: implementers start on `low` (Haiku) and reviewers on `standard` (Sonnet), instead of the spec default of `standard` for both. Failed checks or review findings still escalate an implementer one tier. The mapping is in code (`models.ROLE_TIER`), not in the approval digest, so it applies to the approved plan without re-approval.
* A repair attempt continues the branch that already has a pull request: the last good head is pinned in the harness clone (`harness-good/<issue>`) and the worker starts from it, so its push is a fast-forward. Previously it started from the base branch, diverged, and its push was rejected.
* The harness now publishes a branch it rebased itself with `--force-with-lease`, bound to the exact commit that was reviewed, because GitHub refuses a merge whose commit is not the pull request head. This is the one place the harness force-pushes. It applies only to `harness/*` branches, and the push fails if anyone else moved the branch.
* Publishing and merge errors from GitHub fail an attempt, or are retried, instead of ending the run. An unexpected error in a scheduling pass is reported and retried, and three in a row pause the plan.
* `run --dry-run` used to mark real issues Done and could complete the real plan, so a rehearsal consumed the run. It now runs on a throwaway copy of the store (`rehearsal-<time>/`, kept for inspection) and never touches the real state.
* A merge never advanced the harness's own copy of `main`. Later issues built on a base without earlier work, and post-merge checks ran on stale code. A real merge now fetches `main` from the remote into the clone, and a rehearsal merge fast-forwards the throwaway clone.
* Known limit: the harness only merges through its own publisher. If a human merges a harness PR on GitHub, the scheduler does not notice. A `human-merges` policy therefore stops at review and needs the issue to be closed another way.
* Known side effect: this repository deploys to production when `main` changes (`deploy.yml`), so every autonomous merge of a `sites/lesen` change publishes it.

## Stage 5: Human Tasks, Monitoring, and Delivery (built 2026-10-26)

* Human tasks (`decision`, `asset`, `manual_test`) carry the reason, request, response format, resolution criteria, options, owner, secondary owner, and deadline. They block dependent issues (manual tests do not block an issue that is In Review). Notifications are deduplicated per task round and survive restarts. Reminders: after 24 h, at most 3. Escalation to the secondary owner at 72 h. Silence changes nothing.
* Responses come from `python3 -m harness respond` or the local dashboard (identity from the OS account and the authenticated `gh` login), or an authenticated GitHub interaction passed in by trusted code. Impostors, bots, and untrusted sources cannot move a task. GitHub comments are notifications only. Credential-like content in a response is refused.
* Manual GUI tests follow a validation policy (`manual_testing.allowed_reasons`), name the exact head, are bound to it, and become stale when the head moves. A pass adds evidence but never replaces automated checks. A fail returns the issue for repair. Inconclusive stays open.
* Assets: policy added to the plan (`assets`, covered by the approval digest). Source order: repository, CC0 library, procedural, AI. CC0 library search and AI generation are not available (no MCP chain, no provider), so those steps record why and fall through. Deterministic validation covers format, size, triangles, bounding box, texture size, license, attribution, checksum, absolute paths, embedded scripts, and credentials. Failing twice, no allowed source, or no Blender raises an asset task. Manifest: `assets/manifest.json` with scripts in `assets/scripts/`.
* The Blender runner is headless and host-side. As of 2026-10-27, exact trusted script review is required before execution. Screening, a scrubbed environment, and `--factory-startup` remain defense in depth. Blender is not inside the Docker sandbox, so even reviewed scripts run with the operator's privileges.
* Telemetry: sanitized structured events with plan, phase, issue, attempt, and run ids, kept 14 days and pruned on every pass. `status` and `status --json` show phases, requirement coverage, queue, blockers, workers, runner health, expired leases, pending sync, failures, evidence, human tasks, budgets, and metrics. Tokens, cost, and generation credits are labeled unavailable.
* Initially `status` was the only monitoring interface. The local dashboard added on 2026-10-27 reuses the same SQLite reports and coordinator controls, rather than creating another source of truth.

### Local Dashboard Added 2026-10-27

* Use the Python standard-library HTTP server, vanilla JavaScript, and locally vendored Lucide icons. No runtime frontend dependencies, external CDN, or second state store are required.
* Bind only to loopback. Validate Host, Origin, browser request metadata, and mutation tokens; use nonce CSP and a fixed static allowlist. This trusts the local OS account and is not remote-user authentication.
* Monitor plans, phases, requirements, issue evidence, workers, asynchronous checks, budgets, human tasks, activity, and coordinator output. Support approved start/resume/recovery, pause/cancel, typed decisions, revision-bound manual results, and validated uploads.
* Keep approval and sandbox verification in the terminal. Exact plan-ID confirmation and version checks protect launch/cancel. Dashboard launch can merge and deploy; no real runner or production action was used for browser verification.
* Coordinators survive dashboard closure. Managed-process and log ownership are instance-local, and duplicate detection does not provide a cross-dashboard singleton lock. GUI-only dry runs are not supported.
* Verify HTTP contracts with temporary stores and fake launchers. Browser checks use disposable data, including mobile layout, read-only controls, draft/file retention, stale manual results, decisions, uploads, and pause/cancel requests. Persistent browser end-to-end tests remain future work.

The [test optimization analysis](test-optimization.md) records measured overlap
and runtime opportunities. No existing tests were removed, and parallel testing
was evaluated without changing dependency manifests or CI defaults.

## Stage 4: Scheduler and Runtime Adapter (built 2026-10-26)

* Adapter: `CopilotCliAdapter` runs the real Copilot CLI 1.0.103 in the Tier A sandbox (`--allow-all-tools --no-ask-user --silent`), one container per attempt, killed by name on cancel or timeout. Verified live: `HARNESS_LIVE=1 python3 -m pytest tools/harness/tests/test_harness_live.py` ran a real implementer task, and trusted code fetched the branch, inspected it with `GitRepo`, and ran the check in the sandbox.
* Models (probed, the CLI has no listing command): `low` = `claude-haiku-4.5`, `standard` = `claude-sonnet-5`, `strong` = `claude-opus-5` then `claude-opus-4.8`. Models that the CLI rejected: `claude-sonnet-4.5`, `claude-sonnet-4.6`, `claude-opus-4.5`, `gpt-5.4`. Only one model per low and standard tier is available, so the independent reviewer of a standard implementer runs on the next tier up. The attempt records say so. Model availability is cached for 24 hours in `models.json`.
* Usage per role and tier is not reported by the runtime. The harness now records labeled estimates (see Cancelling, splits, and usage estimates). Worker runs do not pass `--silent`, so usage lines may already be present in the output. The format has not been observed.
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

## Browser smoke check

After PR #26 broke production (a classic script read `window.__storage` before the module script set it) the harness gained a browser-level gate. The worker image carries Playwright Chromium and `smoke/lesen.mjs`; `smoke.json` maps changed paths to it. It is appended to an issue's validation commands (pre-merge, rebase rerun, post-merge, phase validation) and the isolation probe requires it. Failing output tails are included in repair feedback. Verified: passes on `849c734`, fails on the broken `d9c092e`. Limit: it covers the lesen web page only.

## Every worker sees the intent (2026-10-29)

A task packet used to carry the issue's outcomes, criteria, non-goals, anchors and the phrase
`requirement_ids` — identifiers without titles — and nothing about why the work exists. A worker could
satisfy every criterion and still miss the point.

The packet now carries `intent` (one paragraph, set with `harness plan --intent "..."`, part of the plan
digest), `requirement_context` (id and title of each requirement the issue serves) and `phase_context`
(the phase's outcomes, non-goals and exit criteria). The worker prompt tells the model to read them first
and let them decide what a good solution is, not only the acceptance criteria.

## Descoping, and restoring the scope afterwards (2026-10-29)

A plan that cannot finish delivers nothing. `descope.py` lets the triage agent (or the owner) defer a
requirement in small increments so the plan can end, without losing the requirement.

* A deferral is a stored record: requirement, reason, the follow-up issue that still owns the work, the
  actor, and the time. `harness defer PLAN REQ --reason ... --followup ...` writes it, `--list` shows it.
* The envelope lives in the plan policy (`policy.descope`) and is therefore inside the approval digest:
  `allow_deferral`, `max_deferred_requirements`, `max_deferred_share`, `forbidden_requirements`,
  `require_followup`. Off by default; a plan without `allow_deferral` refuses every deferral.
* Deferred requirements count as covered for the phase gate, so the phase can complete and the plan can
  end. Both `_complete_phases` and `_validate_phase` subtract them; `status` prints every deferral.
* The agent may not defer without a reason and a named follow-up issue, may not defer a forbidden
  requirement, and never touches policy, budgets or path allowlists. Those stay owner-only.

Restoring the scope: `harness restore PLAN` writes a follow-up plan (`<plan>-restore-<n>`) containing one
issue per deferred requirement, **chained**: each issue depends on the previous one, so the scope comes
back one increment at a time and only after the increment before it is Done. The draft is an ordinary
plan and needs the usual approval, so nothing is re-expanded behind the owner's back.

## The diff cap counts added lines, not removals (2026-10-29)

`remove-book-pipeline` blocked with `diff exceeds 800 lines` before it could be reviewed: deleting the
EPUB importer removes about 1.950 lines, so a deletion-only issue can never pass a cap on insertions plus
deletions. The cap exists to bound what a reviewer has to read, and deletions of a feature are not read
line by line. `GitRepo.numstat_diff` now reports `added` and `removed` separately and the scheduler
compares `added` with `diff_size_cap`; the failure text names both numbers. A test double that only knows
a total keeps working because the default derives `added` from `numstat`.

## The pull-request budget can be lifted (2026-10-29)

`pull_requests_per_run` defaults to 20. Setting it to `null` in an approved plan's policy means the owner
set no limit: the scheduler stops pausing on this budget and `status` prints `pull requests N of
unlimited`. It stays in the digest like every other budget, so lifting it still needs a new plan version
and an interactive approval. The wall-clock budget (`run_wall_clock_s`) is unaffected and remains the
backstop for a runaway run.

## Declared checks are checked against the allowlist, and worker questions are triaged (2026-10-29)

A refiner stopped issue `coverage-core` with a human question because its validation command, `node --test tests/coverage.test.mjs`, named a file that was neither in the repository nor inside phase P3's path allowlist, so no worker could ever create it. The harness had already run exactly that command three times at preflight (v1, v2, v3) and recorded `Could not find 'tests/coverage.test.mjs'`, exit 1 — but classified it as an ordinary failed check. The classifier looked for `not found`, and Node writes `Could not find`. Import therefore went ahead, and the owner was asked a question that a script could have answered.

* `plans.command_paths_problem` now refuses, before approval and at `import-issues`, any validation command that names a path which does not exist at the base revision and is not inside the phase allowlist. Glob tokens and absolute paths are treated separately. This is deterministic and costs nothing. The effective allowlist is the phase's own plus those of every phase it transitively depends on (`cli.phase_allowlists`): P10 runs `node tools/build_books.mjs --check` and P3 creates that file, so comparing against P10's own list alone was too strict.
* The configuration classifier is deliberately left conservative. Preflight runs at the base revision, where a
  test file that a later issue creates does not exist yet, so Node's `Could not find` must stay an ordinary
  failed check rather than a configuration error: only the declared-path rule above can tell a new file from
  an impossible command. Treating it as a configuration error blocked approval of every plan with
  forward-declared test files.
* A worker's own question (`needs_input`) is now triaged by the `analyst` role before the owner sees a decision task, independent of `analyses_per_issue`, `strong_attempts_per_issue`, and the repair and transient budgets. It is bounded per distinct question, never twice in a row after an analyst attempt, and it does not cover budget or policy failures: trusted code decides those and a model would only add cost. When no strong model is available the launch is refused and the owner is asked as before, so the guarantee degrades to the old behaviour rather than to silence.
* Limit: this triage is a harness role, not the `human-task-triage` chat agent in `.github/agents/`. A VS Code custom agent cannot be triggered by a harness event; the harness only launches sandboxed workers through `adapter.py`.

### Answered questions are not evidence

A decision task lists the issue's last six failures. After the owner answered a `needs_input` question and the
issue moved on, that entry stayed in the list and reappeared on the next task, where it read like a live
blocker for a cause that had already been fixed (`decision-coverage-core-3` showed two such entries).
`humantasks.answered_questions` now drops `needs_input` entries when a decision response releases the issue.
They remain in the journal; only the evidence shown to the owner and the next worker is cleaned.

### Repairing an already imported issue

`runner.import_issues` skips an issue id that already exists (`if store.get_issue(...): continue`), and `import-issues` refuses issue docs whose digest differs from the preflight proof. A new plan version therefore does **not** correct an imported issue: it preflights the corrected docs, then skips the row. The only defined mechanism that replaces a broken issue is the analyst's validated split (option `apply the proposed split`), which needs two or more parts and rewires dependents.

For `coverage-core` the operator amended the row directly with the public store API: `validation_commands` set to `node --test tests/books.test.mjs` (the issue's own code anchor, inside the P3 allowlist), `blocked_reason`, `triage_for`, `analysis_pending` and `analysis` cleared, then `Blocked` → `Ready`. Task `decision-coverage-core-1` was cancelled first. This is operator surgery on trusted state, not a supported command; the missing piece is an owner-facing way to amend an imported issue definition.

## Consequences

* When the attestation lapses the harness drops to Tier B: only `plan`, `approve` on a fixture, `status`, and `--dry-run` operations are permitted.
* Remaining steps for a useful `run` on the real plan: produce refined implementation issues (investigator pass), then `import-issues`. Optionally restrict container egress.
* The requirements file contains no requirement IDs for the Android channel beyond a shared scope statement, so the Stage 2 planner must map each item to the web app, Android, or both.

## Next Invocation

`/setup-project-harness stage=2 requirements=/Users/ursschweigert/Documents/GitHub/DerSchweigert/uploads/20261026_improvements`

## A check that cannot fail is refused (2026-10-30)

The dashboard's "plan and check" died on a draft whose second validation command was
`cd sites/lesen && node --test tests/*.test.mjs || true`. Two defects in the same gate:

* `plans.command_paths_problem` joined every path token with the issue's working directory, so the `cd`
  target became `sites/lesen/sites/lesen` and the gate reported an impossible command. A token now counts
  when it resolves against the working directory **or** the repository root, and tokens that are code rather
  than paths (`require('static/index.html')`) are skipped. The stored draft passes again.
* The `|| true` made the check unpassable-to-fail, so the worker would have "verified" nothing. The owner
  chose to refuse such commands: `plans.command_problem` rejects a command that ends in a fallback which
  always succeeds (`|| true`, `|| :`, `|| exit 0`, `; true`, `; exit 0`). This runs in `build_plan`,
  `import-issues`, splits and preflight, so a plan stops at authoring time rather than mid-run. `a || b` with
  a real fallback (`|| echo failed`) stays allowed.

The same draft showed the second defect of the dashboard: a failed preparation was only visible inside the
Planning view, so the button looked stuck. The header banner now reports a failed or running preparation for
the selected plan, and the investigate/prepare buttons carry a title naming the blocker.

Rows in the dashboard followed the alphabet of issue ids, so progress read sideways rather than downwards and
looked like it was jumping. Issues, queue, workers, checks and blockers now follow plan order, then phase
order, then issue id: a stable total order that only ever appends.

## A run lands on its own protected branch, and `main` only moves when the owner says so (2026-10-30)

Every run merged into `main`. That is convenient but it means autonomous work reaches the deploy branch in small
steps, and a run that goes badly has to be reverted out of `main`. The owner asked for a run branch that is
protected like `main`, created as soon as a run starts.

* `policy.base_branch` (default `main`) and `policy.run_branch` (default `harness/run/{plan}`) are new, and both sit
  inside the approval digest. An empty `run_branch` means the old behaviour: work directly on the base branch.
* `runner.build_scheduler` creates the run branch at the current base head with `ensure_run_branch` and then uses it
  as the base: trusted clone, adapter, `GitHubPublisher.base`, rebases, and the `merge_protection` gate all follow it.
  An existing branch is reused, so `resume` continues instead of starting a second branch.
* Protection is a repository ruleset, not something the harness creates: `harness run branches` covers
  `refs/heads/harness/run/**` with no direct pushes, no force pushes, and the strict required checks `test` and
  `test-ffm`, with no bypass actors. The harness keeps its rule that it never changes GitHub protection settings; it
  verifies the effective rules for whatever base it uses. The deletion rule is deliberately omitted so a promoted run
  branch can be cleaned up, which is impossible on `main`.
* On completion the scheduler opens one pull request from the run branch into the base branch (`open_promotion`,
  event `promotion_pr`) and never merges it. A failure to open it is reported as `promotion_failed` and does not undo
  the completed plan.
* `reconcile` compares the PR's base with the issue's own plan base branch instead of the literal `main`.

Limit: preflight and `import-issues` still inspect the base branch (`main`), because a plan is authored against the
repository as it is, not against an in-flight run branch. An issue imported mid-run therefore records `main`'s head
as its first base; the scheduler rebases it onto the run branch head before it dispatches.

## Plans and workspaces can be hidden from the dashboard (2026-10-30)

The dashboard listed every plan that ever existed and every workspace that was ever created, seven plans and four
workspaces after a day of work. Selecting the wrong one is easy, and the workflow buttons of a stale workspace look
"dead" because its plan is already `Paused` or `Completed`.

`gui_workflow.set_archived` writes a `plan:<id>` or `workspace:<id>` record into the existing `gui_archive` document
store, and `gui.snapshot` / `/api/workflow` drop those ids from the lists they serve. Nothing is deleted: `status`
and `harness issue` still show everything, and `harness archive KIND ID --undo` brings it back. Issue archival keeps
its own unprefixed keys, so the two never collide.

The buttons also carry a title now. Every disabled state names its reason ("Only a Proposed plan can be approved;
this one is Paused", "Type the first 12 characters of the digest exactly"), so a click never silently does nothing.

## Requirements can be corrected in place, and a cancelled plan can be revised (2026-10-30)

The dashboard offered only one way to change a requirement: **Save requirements** always created a new workspace, so
every wording fix paid for a fresh investigation and left another workspace behind. And once a plan had been approved
and cancelled, its workspace accepted no revision at all ("approved or executing workspaces cannot be revised"), so
even the draft could not be corrected.

* `gui_workflow.update_requirements` rewrites `requirements.md`, `source.md` and the workspace record of the selected
  workspace, refusing only while its plan is `Executing`. The next `plan` step builds a new version from the new text,
  so the new digest still needs the owner's approval; nothing moves behind an existing approval.
* The GUI gained **Update this workspace** next to **Save as new workspace**, and the requirements editor is prefilled
  from the selected workspace instead of only from an upload.
* A `Cancelled` plan may be revised again (`investigate`, `plan`), because a cancelled run is terminal and produces a
  new version that needs a new approval. Approved, executing and paused workspaces stay locked.
* `Scheduler.start` clears a leftover `cancel_requested` when the plan starts from `Approved`: a new approval starts a
  new run, not the cancelled one. Without this, a new version of a cancelled plan cancelled itself on its first tick.

## A corrected plan reaches the issue it corrects (2026-10-30)

`runner.import_issues` skipped every issue id that already existed (`if store.get_issue(...): continue`), and ids are
global across plans. A corrected requirement therefore produced a new plan version, a new approval and a fresh
`import-issues` that silently changed nothing: the run would execute the old definition. The same silence hid the
case where an id belonged to a different plan, which cost a debugging session earlier.

* An unchanged definition is still a no-op, compared only on the fields the document states so harness defaults do not
  look like a change.
* A changed definition replaces the issue when nothing has landed: no `head_rev`, no pull request, no active claim and
  the state is `Inbox`, `Refining`, `Ready` or `Blocked`. Failed attempts do not block it; they left no work.
* Anything else refuses loudly (`issue %s is already %s and has work recorded`) instead of skipping, and an id that
  belongs to another plan refuses with that plan named.
* `import-issues` writes an `import_report` document per plan listing `added` and `replaced`, so the GUI and the
  operator can see that the corrected definition actually arrived.

## The run clock stops when the run stops (2026-10-30)

`status` computed the run's wall clock as `now - started_at`, so the dashboard kept counting after the plan was
cancelled, completed or paused: a cancelled run showed a growing "Run time" against its budget, and a run that sat
paused for an hour resumed with that hour already charged — enough to trip `run_wall_clock_s` immediately.

`Scheduler._pause`, `_cancel` and `_complete_plan_if_done` (and `runner.request_pause` when it pauses without a
runner) now record `run["ended_at"]`, and `status` charges up to that stamp instead of up to now. On the next
`start()` the clock is shifted by the idle gap (`started_at += now - ended_at`) and the stamp is dropped, so a
resumed run pays only for the time it actually runs.

## Changing a requirement invalidates the draft, and a run branch is never thrown away silently (2026-10-30)

**The draft.** After **Update this workspace** the dashboard kept "Start investigation" disabled because a draft already
existed, and "Revise draft with feedback" needed text — so the only visible action did nothing. The workspace record now
carries `draft_stale` when requirements change after a draft was written. A stale draft re-enables **Start investigation**
(the new wording is investigated from scratch; the old draft stays in `draft/` until it is replaced) and blocks
**Prepare plan and checks** with that reason, so a plan can never be built from a draft written for other words.

**The branch.** Nothing asserts a discard because nothing discards: cancelling is a state change only. Work a cancelled
run already merged stays on its protected run branch, `main` was never touched, and a new version of the same plan
reuses the same branch and stacks on top of it. A test pins that: after a cancel the run branch and the base branch are
byte-identical to before. To throw the work away the owner says so explicitly — `harness discard-run PLAN` deletes the
run branch (refused while the plan is `Executing` or `Paused`, and a no-op when the branch is already gone), so the
next run starts from the base branch again.

## A rejection at the strongest tier earns one repair, not five (2026-10-30)

An investigation on `deepseek/deepseek-v4-pro` ran four attempts and would have used all six. The repair loop escalated the
tier on every rejection, but the investigator was started at the top tier, so every retry ran the same expensive model
with no stronger option behind it. The owner pays per attempt and asked for pro to be reserved for planning and real
escalations.

`MAX_TOP_TIER_ATTEMPTS = 2` in `investigate.py`: once an attempt at the strongest tier is rejected, only one repair attempt
at that tier follows, then the run stops with the collected problems (and `rejected-draft.json`). Below the top tier the
old ladder still applies, so a standard-tier run gets at most standard, then two strong attempts. Every rejection now also
logs its reason, which is what the dashboard shows.

## Re-importing a plan retires the issues it no longer names (2026-10-30)

The corrected plan v2 renamed the old issue: v1 had `consolidate-mode-selection`, v2 split it into
`consolidate-setup-stylesheet` and `unify-mode-selection`. `import-issues` added the two new ones and left the old row
`Ready` in the same plan, so the dashboard showed three issues and the run would have dispatched a task the plan no
longer contains.

* `import_issues(..., replace=True)` — what `import-issues` and the dashboard's **Import approved issues** declare — treats
  the file as the plan's whole issue set: an issue of this plan that the file does not name and that has no work (no
  `head_rev`, no pull request, no claim) is moved to `Cancelled` and reported as `superseded`.
* An unnamed issue that already has work refuses the import before anything is written, because the plan no longer
  covers what was done.
* Callers that add a subset (an approved split, `import_issues` without the flag) are unaffected: the earlier
  split-and-resume flow keeps its sibling issue.

The import report now lists `added`, `replaced` and `superseded`.

## A worker that never started costs nothing, and a run branch is a usable base (2026-10-30)

The first real run on a run branch blocked issue `consolidate-setup-stylesheet` with `model selection rejected: strong
attempt budget exhausted`, 4 seconds after start. Two defects behind it:

* `adapter._prepare` checked out the base branch by its **local** name. A fresh clone knows a non-default branch only as
  `refs/remotes/origin/<branch>`, so `git checkout -B harness/<issue> harness/run/<plan>` failed with exit 128 — the
  run-branch feature could never have started a worker. The base now resolves to the remote-tracking ref when it exists.
* That infra failure still consumed the single `strong_attempts_per_issue` slot, because the budget is charged when the
  attempt is dispatched. The retry then could not use the strong model and blocked the issue. An attempt whose worker
  never started now refunds the slot.

The block also reached the owner as a `decisionRequested` task instead of being triaged, because this plan carries no
`auto_answer` policy: it was built from `DEFAULT_POLICY`, which has no `auto_answer` and no `descope`. Putting open-ended
descoping into the defaults was attempted and reverted — a failing check then defers its requirements instead of
reporting them, which changed 74 tests and the semantics of a red test. The standing instruction therefore stays a plan
decision, and a new plan must be prepared to carry it.

## One runner per plan, enforced (2026-10-30)

Three `harness resume` processes were alive at once for the same store: one for a finished plan, one for a cancelled
version and one for the current version. They ticked against the same claims and budgets, produced duplicate human tasks
and left the dashboard saying "run active" while nothing did any work.

`store.claim_plan` gives a plan a single owner (document `plan_owner`: runner id, pid and heartbeat). `Scheduler.start`
refuses with the holder's name when a live runner owns the plan, every tick refreshes the heartbeat, and `run_loop`
releases it in a `finally`, so a Ctrl+C frees the plan immediately. A holder whose pid is gone, or whose heartbeat is
older than two heartbeats, is replaced — that is what makes a crash recoverable without an operator clearing state by
hand. The error names the holder and the remaining lock time.

## A splittable task does not get the strongest model (2026-10-30)

The owner pays for `deepseek-v4-pro` and asked for a fixed rule that decides whether a task sent to the top tier could
be several cheaper tasks instead. It must not be a model's own opinion of how hard its work is, so the rule is
arithmetic over facts the plan already states (`tools/harness/sizing.py`):

| Fact | Limit |
|---|---|
| anchored files (`code_anchors` + `contract_paths`) | 3 |
| bytes of those files at the base revision | 60 000 |
| requirement ids | 1 |
| acceptance criteria | 6 |
| separate areas (first two path segments) | 2 |

Any breach marks the task as worth splitting. The scheduler applies it where it is cheapest: when an implementer would
run at the strongest tier and the rule fires, that attempt is routed to the standard tier instead and a `split_pressure`
event reports the facts, the reasons, the model that would have been used and the one that was. Nothing is blocked and no
question is asked; if the cheaper attempt fails, the existing delegator and analyst path can still propose a real split.

`policy.split_pressure` is off unless `enabled` is true, so no existing plan changes behaviour, and its keys and values
are validated in `validate_plan` — a typo such as `max_file` is a plan problem, not a silently weaker rule.

## Run-branch pull requests must run the checks, and silence is not idleness (2026-10-30)

Two gaps the first real run exposed minutes after it started:

* **No CI on the pull request.** `deploy.yml` ran on `pull_request: branches: [main]`, so PR #102, whose base is
  `harness/run/<plan>`, produced no `test` or `test-ffm` run at all — while the run-branch ruleset demands exactly those
  two checks. The trigger now includes `harness/run/**`. Deploy jobs keep `github.ref == 'refs/heads/main'`, so nothing
  deploys from a run branch; the deploy happens when the owner promotes the run branch to `main`.
* **A working reviewer was fenced as inactive.** The reviewer of PR #102 printed nothing for ten minutes while its
  container used 121% CPU analysing a stylesheet, so `inactivity_timeout_s` (600 s) killed it and started a fresh
  attempt. The adapter now treats a changed file in the worker's own work directory as a sign of life: after
  `ACTIVITY_SCAN_AFTER_S` (60 s) without output it scans the work directory and takes the newest modification time as
  activity. Output alone was too narrow a definition of work.

## A check job cannot wait for a pipe whose writer is gone (2026-10-30)

After PR #102 merged, the `integrated` check that verifies the merge on the run branch never finished: the plan stayed
`In Review` for minutes while no container existed. `SandboxChecker.poll` returned "not finished" whenever the output
reader thread was alive — even when the process had already exited. If the reader outlived its writer, the poll answered
`None` forever, the lease kept being refreshed, and nothing could time out.

`poll` now returns early only while the process is alive; once it exited, the reader is joined for at most two seconds
and the exit code decides. A stuck reader can delay a result by two seconds but never suppress it.

## The next plans start with these three defaults (2026-10-30)

The owner asked for three settings to become the default for new plans. All three live in `DEFAULT_POLICY`, so they are
inside the approval digest of every plan built from now on; the running plan keeps the policy it was approved with.

* **`strong_attempts_per_issue: 2`** instead of 1. The first attempt and one repair may both use the strongest model;
  repetition past that is still capped. Before, the expensive attempt came first and every repair had to fall back to a
  cheap model, which inverted the intent.
* **`split_pressure: {"enabled": true}`** — the measured rule from this morning now applies by default: an implementer
  that would run at the strongest tier is routed to the standard tier when the task breaches a limit (3 files, 60 000
  bytes, 1 requirement, 6 acceptance criteria, 2 areas), and a `split_pressure` event records why.
* **Refiner guidance in the investigator prompt**: the refiner only re-checks a task and writes nothing, so its model
  follows the *task's* uncertainty — cheap for a bounded task with concrete anchors, stronger when its assumptions rest
  on interacting components — instead of defaulting to the cheapest model.

## The refiner plans the work before a paid implementer is dispatched (2026-10-30)

The order used to be: the investigator declares a tier, and a `standard` or `strong` implementer discovers the shape of
the work while already editing files. Complexity therefore arrived on the most expensive model, and `strong_attempts`
was spent before anyone knew whether the task was really that hard.

The plan pass moves that judgement forward. For an issue whose declared implementer tier is `standard` or `strong`,
`_dispatch` sends the issue to `Refining` before the first implementer attempt. The refiner — a cheap tier, and only
when the model selection is already valid — verifies the anchors as before and additionally:

* writes `plan`, the concrete steps per file, which the implementer receives in its packet as `plan`;
* reports `tier_fit`, the cheapest tier whose model can execute that plan. When `tier_fit` is lower than the resolved
  route, `_launch` routes the implementer there and emits `tier_lowered_by_plan` — the paid model is not spent on work a
  cheap model can follow.
* may set `split_advice` instead of a plan when the steps cannot be made small enough for one implementer. The issue is
  then blocked with that sentence as the reason, so the existing delegator/analyst path produces a validated split
  (`splits.validate_analysis`, `_write_split`) instead of an implementer discovering the size mid-task.

A low-tier issue is not planned first: there is no cheaper tier to discover, so the pass would only cost a round trip.
`planned` marks the pass as done, so a refiner that returns nothing is never asked again.

**Nothing in this path names a model.** The instruction speaks of `low`/`standard`/`strong`, and every route resolves
through the plan's `policy.model_tiers`, which `with_model_sources` derives from the chosen `model_sources`. A plan bound
to `deepseek` is planned, judged and implemented with DeepSeek ids only; a test pins that no dispatched role leaves the
approved tiers.

## A finished run is never left with a pull request nobody can merge (2026-10-30)

The plan finished, the promotion pull request #111 (`harness/run/...` → `main`) was opened, and then nothing happened for
hours. `gh pr checks` reported *no checks at all*, and the pull request was `CONFLICTING`: GitHub cannot build a merge
commit for a conflicting pull request, so it never triggers `pull_request` workflows, so the required `test` checks never
appear and nothing can be merged. The GUI said "healthy" because it only knew about the runner, not the promotion.

The cause was the run branch's history: it had been "synced with main" by a squash commit, which threw away the ancestry
that would have made the later merges trivial. Every later change on `main` then collided with the branch's own copy of
the same files.

Two changes close the class:

* **The promotion syncs the base through a pull request, because the run branch only accepts changes that way.** The
  ruleset on `harness/run/**` requires a pull request, so a direct push of a base merge is declined; the harness merges
  the base into the run branch in a worktree of its trusted clone, pushes the result to `harness/run-sync`, opens that
  pull request into the run branch and merges it once its checks pass. Only then does it open the promotion pull request,
  which is mergeable by construction. `main` moves during a long run, so a sync at promotion time is normal, not an
  accident.
* **A blocked promotion is reported, never silent.** If the sync cannot merge (a genuine conflict, or checks that do not
  turn green), no promotion pull request is opened — an unmergeable one only looks like progress — and the reason is
  stored on the run, emitted as `promotion_conflict`, and shown in the GUI banner and in `harness status` as
  `PROMOTION BLOCKED: …`. A successful promotion shows as "Promoted as pull request #N; only you merge it."

## The finished run asks for its merge, and a split is analysed before the owner sees it (2026-10-30)

Two gaps closed.

**The promotion had no owner decision in it.** The finished run opened its pull request and the GUI said nothing, so the
last step of a run looked like the first: wait and see. A finished plan now raises a `promotion` task
(`promotion-<plan>-<pr>`) that names the pull request, links to it and offers "merged the pull request" / "keep it open
for now". The harness still never merges into the base branch. Because the owner merges on GitHub rather than in the GUI,
the harness reads the pull request back (`pr_merged`) on every pass of a `Completed` plan and closes its own ask as soon
as the merge is real — the task is a reminder with an audit trail, not a gate the owner has to answer.

Watching needs a process: `run_loop` used to stop the moment a plan was no longer `Executing`, which would have left the
ask open forever. A finished run whose pull request is still open now keeps ticking at `PROMOTION_POLL_S` (30 s) instead
of stopping, bounded by `PROMOTION_WATCH_S` (6 h), so an abandoned runner cannot watch a pull request indefinitely.

**Sizing work down was left to the owner.** When the refiner said a task could not be made small enough for one
implementer, the issue was blocked straight into a decision task: the owner was handed the raw judgement and had to
invent the split. Sizing is an analysis, so that path now goes through triage first: the `analyst` (strong tier — the only
role that plans at that level) produces the root cause and, where it fits, the validated smaller issues, and the owner is
asked only to apply them. The split advice is therefore also the first place where the two halves of the rule meet: the
expensive model analyses, the small models execute.

A finished run whose runner already exited cannot be resumed — `start` refuses a `Completed` plan, which is right, because
resuming would re-enter execution. `resume` on such a plan now *watches* instead: `watch_promotion` claims nothing, starts
nothing, and only reads the pull request back until the ask closes or `PROMOTION_WATCH_S` expires.

## The harness can build and verify a Godot 4 Android game (2026-10-30)

Requested by `uploads/gotoextentionharnesspromt.md`: the worker image could run a browser and Blender, but no engine, so
every phase that wanted `godot --headless` would have been blocked.

**Godot version policy: pin 4.7.2-stable, exactly.** The image carries the official Linux editor build for amd64 and
arm64, and `worker/install_godot.py` refuses anything whose bytes do not match the release's `SHA512-SUMS.txt` value
(`9aa00f7a…` for x86_64, `dd5991…` for arm64). There is no "latest" path: an upgrade is a deliberate edit of the release
name and both hashes, followed by an image rebuild and a new attestation. 4.7.2 was the current stable release on
2026-10-30; the game pins the same version in its own project file, so engine and tooling cannot drift apart.

Only `libfontconfig1` is added as a dependency. The probe showed the editor binary links nothing else that Debian slim
lacks: X11, GL, and audio drivers are opened lazily by the display drivers, which workers never start. Export templates
and the Android SDK stay out; RL1 builds a signed AAB in a human-owned workflow, and shipping an SDK into the sandbox
would only invite a worker to try.

**Test framework: GUT, baked into the image.** The alternative was vendoring GUT (or gdUnit4) under
`apps/arithmoslayer/addons/`. Vendoring would put third-party code into every worker's diff, need an approved plan that
authorises `addons/`, and give the worker edit rights over the framework it is judged by — the one thing the review gate
cannot check for itself. Instead GUT 9.6.1 is cloned at image build and the checkout is proven by comparing `HEAD` with a
pinned commit (`c80954f4…`), which `git` hashes rather than the network. `godot-test` copies it next to a throwaway
project, so `extends GutTest` compiles and the repository stays free of `addons/`. `addons/` is now an escalation path
anywhere in the tree, so a worker that tries to vendor something is sent to a human instead.

The cost is honest: GUT's behaviour is part of the image, so a GUT change is a harness change reviewed in this repository,
not a line in a pull request. GUT's "new version available" line is computed from its bundled version list and never
fetches; the pinned copy cannot upgrade itself.

**A headless load check that actually fails.** `worker/smoke/godot_project.sh` copies the project to tmpfs, imports it,
and runs `godot_verify.gd`, which loads every `.gd`, `.tscn`, `.scn`, `.tres`, `.res`, and `.gdshader` and instantiates
every scene. Three engine behaviours had to be discovered by experiment, and each is recorded in the script:

* A failed parse inside a `--script` main loop crashes Godot 4.7.2 (signal 11) while it prints the error backtrace. The
  verifier mutes `Engine.print_error_messages` around each load and reports the failures itself.
* A script that fails to parse still comes back as a `GDScript` object, so `null` alone is not a failure signal;
  `can_instantiate()` is.
* Loading the running script with `CACHE_MODE_IGNORE_DEEP` crashes the engine, so the cache mode is `REUSE` and the
  verifier skips itself.

**Assets: audio and fonts, with real parsers.** The policy gains `audio_sfx` (wav, ogg; 500 kB, 3 s, 48 kHz, 2 channels),
`audio_music` (ogg; 3.5 MB, 180 s, 48 kHz, 2 channels), and `font` (ttf, otf; 1.5 MB). The ceilings are per file and sized
against the 150 MB AAB: twelve three-minute tracks at about 2 MB each are the largest single block, and a typical effect
is 10-50 kB, far below its ceiling. WAV is read with `wave`; Ogg Vorbis with a page walker that reads the identification
header for channels and rate and the last granule for length; fonts with an sfnt magic and table-directory check that
also refuses tables pointing outside the file. Anything unreadable fails closed, including chained or multiplexed Ogg
streams, which the reader does not support.

Licences: `font` replaces the global list with `OFL-1.1` and `Apache-2.0`; every other class keeps CC0-1.0. A font must
ship its licence text next to it, which the harness copies to `<font>.LICENSE.txt` and records with a checksum — the OFL
requires the notice to travel with the font, and a manifest note would not satisfy that. No new fetchers were added:
audio and fonts have no automated source, so a request becomes a human asset task, which `humantasks.py` already handled
generically through `extra.asset_class`.

**Asset directories are per plan.** `--assets-dir` (or `{"assets": {"output_dir": …}}` in the investigator's
`phases.json`) moves the asset root to, say, `apps/arithmoslayer/assets/`. It is validated as repository-relative, must
end in `/`, and cannot contain `..`; traversal and symlink checks are unchanged and run against the new root. Because the
value lives in the policy, it is bound by the approval digest, so moving it later needs a new approval.

**Escalation matching grew two modes.** `is_escalation` matched a prefix, an exact path, or a base name. It now also
matches a directory named in the policy at any depth (an entry ending in `/`, so `addons/` catches
`apps/x/addons/gut/y.gd`) and a file suffix (an entry starting with `*.`). The policy uses both: `export_presets.cfg`
holds signing settings, `apps/arithmoslayer/android/` is the build template, and `*.gdextension`, `*.so`, `*.aar`,
`*.jar`, `*.apk`, `*.aab`, `*.keystore`, and `*.jks` are native or store artefacts no worker should produce unannounced.

**What was deliberately not done.** No export templates, no Android SDK, no new network fetcher, no change to
`paid_generation_credits` (still 0) or to the disabled `ai` source. `godot`, `godot-test`, `gdlint`, and `gdformat` pass
the validation-command filter; the network, privilege, container, and publishing tools it blocks stay blocked.

**Known limits.** Headless Godot cannot render, so nothing here verifies look, shader behaviour, or frame time; those stay
`visual_judgment` and `physical_device` tasks. Software rendering was considered for screenshots and is not feasible in
this image: Mesa, Xvfb, and a GL driver would add hundreds of megabytes and a second GPU path to trust, and a screenshot
of an emulated GL stack would still not be the reference device. The Godot checks copy the project into the container's
256 MB `/tmp` tmpfs, so a large project will need a bigger sandbox — a change that invalidates the attestation and is
therefore a deliberate one. `apps/arithmoslayer/` does not exist yet; the rule is live and will apply as soon as it does.

## A run has no wall-clock or pull-request cap by default (2026-11-02)

The defaults used to stop a run after 8 hours or 20 pull requests. Both were guesses from the design phase, and both
turned out to cut long, healthy work short: the runner paused mid-plan, and the remaining issues stayed `Ready` with
nothing wrong except the clock. Cycles are now unbounded on both counts — `run_wall_clock_s: None` and
`pull_requests_per_run: None` — so a run keeps scheduling until its issues are Done or the owner pauses it.

There is no separate issue cap to remove: one issue produces one pull request, so the pull-request budget was the issue
budget. The other budgets still bound spending rather than calendar time: 2 workers, 2 repair attempts, 3 transient
retries per issue, a 30 minute worker limit, and the 10 minute inactivity limit. A run that loops on a broken issue is
therefore still stopped by the repair budget and a blocked issue, not by the clock.

`None` means "the owner set no limit" everywhere the value is read: the scheduler skips the wall-clock check, `status`
reports `limit: null` and `remaining: null`, and the dashboard prints "no limit". The values stay part of the approved
policy, so a plan that wants a cap can still name a number and get it bound by the approval digest.

## A republished branch replaces only the head the harness recorded (2026-11-02)

A worker cannot resolve a merge conflict. Its own push is not the problem — the coordinator pushes — but the coordinator
used `push_branch`, which never forces. When the harness had rebased an issue's branch onto a newer base, the remote
still held the older commits and the push was refused as "behind its remote counterpart". The issue then blocked with
`push_rejected` after the rebase had already succeeded, and no worker could ever get past it.

`GitHubPublisher.open_pr` now republishes an existing branch with `push_rebased`, which is `--force-with-lease` against
the head the harness recorded for that issue. Two effects: an issue that had to be rebased lands, and a branch that
somebody else moved is refused rather than overwritten. A branch without a recorded head is still a plain push, so the
first publication keeps its no-force guarantee.

## An issue can be added to a plan whose issues already have work (2026-11-02)

`import-issues` always replaced the plan's whole issue set, and an issue that has been worked cannot be replaced
(`_adopt_or_refuse`: a recorded head or an active claim is final). Together that made the documented recovery
impossible: a cancelled issue left a requirement uncovered, and the replacement the manual asks for could not be
loaded, because any file that named the remaining issues hit the "already has work" refusal and any file that omitted
them superseded them.

`import-issues --add` now loads just the issues in the file and leaves the rest of the plan untouched. Preflight for
those commands still runs, and re-importing a file whose issues are unchanged stays idempotent. The preflight also
runs each distinct command once per revision now, so a file of fifty issues that share four commands costs four
sandbox runs instead of two hundred.

## A cancelled issue that never worked can be put back (2026-11-02)

Cancelling an issue cascades to every issue that depends on it, which is right when the work is abandoned and wrong when
the cancellation was a mistake: twelve issues that had nothing to do with the cancelled one were cancelled with it, and
`Cancelled` was terminal, so `import-issues` could not bring them back.

The issue machine now allows `Cancelled -> Ready` for exactly one caller. `runner.import_issues` revives a cancelled
issue only while nothing ever landed for it — no head, no pull request, no claim — and rewrites the definition from the
imported document, so a repaired `deps` list takes effect. An issue cancelled after it reached a pull request stays
cancelled; the answer there is a fresh issue, not a resurrection.

## Imported issues are bound to the remote base, and re-importing re-anchors them (2026-11-02)

`import-issues` recorded the local `main` head as every issue's `base_rev`. That is only correct while local `main`
matches the remote: with unpushed harness commits, the run tried to diff a commit its trusted clone had never fetched
and paused with `git diff failed: fatal: bad object`. The base now resolves to `refs/remotes/origin/<base>` when it
exists, so an issue is always bound to a revision the run can actually see.

Re-importing an unchanged issue also refreshes its `base_rev`. Without that, issues imported under the wrong base kept
it forever, because `_unchanged` short-circuits before the record is written.

## A role prompt and the result schema must name the same keys (2026-11-02)

The refiner's prompt deliberately dropped `checks` from its example — a refiner changes no files, and every check that
counts is run by trusted code, never read from a worker's report — while `WORKER_RESULT` still required the key. A
refiner that followed its own instructions therefore failed as `schema_invalid: result.checks: missing`, and only a
model that volunteered an unrequested key could pass. It cost three attempts on `p2-problem-generator` and single
attempts earlier on two other issues.

`checks` is optional now, and a test builds every role's prompt, parses the example out of it, and asserts that the
result it describes validates — and that the prompt never asks for a key the schema forbids. That is the general
defect behind the symptom: two trusted artifacts describing one contract, with nothing checking that they agree.

The 800-line diff cap is unchanged. It is not what failed here, and it did its job on `p2-curriculum-data`: a 1346-line
diff was refused, the issue was re-planned into seven steps, and the smaller diff merged as PR #146. Raising the cap
would let a thousand-line data change through review, where the band values nobody can verify by reading a diff.

## An oversize diff is a split, and the worker is told the budget (2026-11-02)

`diff_too_large` was classed a policy failure, and a policy failure blocks on the first occurrence. So the very first
attempt that wrote more than 800 lines ended the issue and asked the owner — while the machinery that could have fixed
it (the analyst, whose `split_rules` already carry `diff_size_cap`) was only reachable from a worker's stuck report. Two
issues blocked that way within minutes of each other, at 1538 and 1618 added lines.

Two things were wrong, and only one of them was the classification.

1. **The worker was never told the limit.** The task packet carried the path allowlist, the validation commands, and the
   phase context, but not the diff cap. The harness enforced a number the worker could not read, then punished the
   first miss. `diff_budget` is now in every packet (`max_added_lines` plus the rule), and the implementer and refiner
   instructions name it, including what to do instead of writing more: report blocked with what should be split off.
2. **The recovery path was unreachable.** An oversize diff now schedules the sizing analysis when the analysis budget
   allows, exactly like a stuck report: the analyst reads the work and proposes parts that fit, and the owner applies
   the split. With no analysis budget left it still blocks, and the task says so.

The cap itself stays at 800. It is doing what it is for: `p2-curriculum-data` at 1346 lines became seven planned steps
and merged as PR #146. What changed is that the harness now tells the worker the number, and treats a size miss as a
sizing problem rather than a policy breach.

## The overseer: a top-tier agent for process questions (2026-11-02)

Every stuck issue used to become an owner decision, whatever the cause: a harness bug, a plan that was too big, a
transient race. Reading those and choosing "retry, extend, or refine" is not a judgement about the game — it is the
cheapest possible triage, and it was consuming the owner's attention dozens of times per phase.

There is a dedicated `overseer` role now, **off unless the plan opts in** (`harness plan --overseer`). The harness has always held that budgets and policy are decided by trusted code, not by a model; the overseer is an explicit, bounded exception the owner grants per plan, and the setting is part of the approval digest. It runs on the strongest approved tier (`models.REQUIRED_TIER`, so a plan
cannot downgrade it), it is dispatched exactly like any other helper, and it answers with one of four actions and one of
four causes.

* **What it may do:** `retry` (with a hint), `extend_budget`, `refine`. These are the same three outcomes an owner
  answer produces, applied through the same code path.
* **What it must escalate to the owner:** `cause: harness_defect` and `cause: content`. Its reason is attached to the
  decision task as `overseer_finding`, so the owner sees the diagnosis rather than only the raw failure. That is how the
  `checks`-contract bug and the stale-runner fencing would have arrived: named as harness defects, with evidence.
* **What it never touches:** cancel, approve, merge, policy, or `tools/harness/`. `schemas.OVERSEER_ACTIONS` is the
  closed list, and anything outside it is rejected as an unusable decision. Authority failures — scope breach,
  escalation path, permission, approval, isolation, plan budget — are excluded by `OVERSEER_KINDS` and go straight to the
  owner, because those are exactly the cases where a model must not decide.
* **How it is bounded:** `policy.overseer.rounds_per_issue` (default 2) and the fact that it is an ordinary attempt with
  a lease, a timeout, and an inactivity limit. When its rounds are spent, the issue blocks with the decision task as
  before.

The honest limit: an overseer that misclassifies a real content question as `process` would let a retry loop run twice
before the owner sees it. That is why the escalation causes exist and why the guarded list of actions is closed; a run
where the overseer fires repeatedly on the same issue is a signal about the harness, not about the task.

## A worker that never starts is the environment's failure, not the issue's (2026-11-03)

Four issues blocked with four identical decision tasks: `adapter failed to start: git clone ... returned non-zero exit
status 128`. The cause was the host: 84 GB of worker directories had accumulated, the disk was full, and no attempt
could be prepared. Three defects, found in that order.

1. **Working copies were never released.** Every attempt gets its own directory with a full clone of the repository and
   everything the worker built in it, and `Adapter.cleanup` existed but was only ever called by the investigator. Each
   attempt left ~300 MB behind. The scheduler now releases a copy in the same step that ends the attempt (`_release`,
   used by every terminal path, including lease loss and cancel), a half-prepared directory is removed when preparation
   throws, and a long-running runner reclaims directories older than four hours at start — longer than any worker run
   or check job, so it can never delete a copy that is still in use.
2. **The failure was classified as an issue problem.** `infra` means the worker never started: nothing was learned about
   the issue, and retrying that issue cannot help while every other issue is about to hit the same wall. Four retries
   per issue and a decision task each buried the one fact the owner needed. When the retry budget is exhausted and every
   recorded failure for the issue is `infra`, the issue is released and **the run pauses once**, naming the environment
   error. A transient failure after a worker actually ran still blocks with a decision task, because then the issue's
   own work is in question.
3. **Nothing looked at the disk.** `_dispatch` now checks free space on the worker root and pauses the run below a floor
   (4 GiB by default, `WORK_ROOT_FREE_BYTES`, set by the runner) instead of spending four attempts per issue to
   discover it. The check is a constructor parameter defaulting to 0 so a scheduler driven by test doubles, which
   start no worker, is not coupled to the host's disk.

The overseer is deliberately not in this path. A model cannot free disk space, and asking one to classify a host fault
would spend a round to learn what the error message already said. The harness pauses, the operator frees space, and the
run resumes: the same shape as an isolation failure. Failures that are *about the work* still reach the overseer.

## A lease detects a dead runner, not a busy one (2026-11-03)

Within three hours of the disk fix, all four P3 issues were blocked again, this time with `lease_lost`: *lease expired,
worker fenced*. The worker had not failed. Every attempt — implementer, refiner and even the overseer's own — was
fenced 2 to 16 minutes after it started, spent a transient retry, and after three of those raised a decision task.

`lease_s` is 90 seconds and was renewed **only** from the scheduling pass. Any call in that pass that took longer than
90 seconds therefore fenced every worker in flight. The pass makes network calls: task notifications go through `gh`,
publishing goes through network `git`, and neither had a timeout. A stall of a minute or two was enough; the 16-minute
gaps were stalls, not worker time.

Three changes, in the order they matter:

1. **Renewal moved off the scheduling pass.** A daemon thread renews every live attempt's lease every `heartbeat_s`,
   using its own SQLite connection and an `UPDATE` that carries the epoch and the `expires_at > now` condition, so it can
   never revive a lease the scheduler has already fenced. The lease now measures whether the runner *process* is alive,
   which is what it is for.
2. **Every call a pass makes is bounded.** `gh` gets 60 seconds, network `git` 300, the preparation clone 300. A stalled
   call raises, is classified (`_publish_kind` and friends), and the pass continues instead of freezing the run.
3. **A failing notification cannot stop the run.** `tick_tasks` is wrapped; a failure is emitted as `notify_failed` and
   the pass carries on. A comment on a GitHub issue is a notification, never evidence.

The pass is also instrumented: any stage taking 20 seconds or more is named in the run log as `tick_slow` with its stage
and duration. The first two fixes make this class of failure harmless; the instrumentation is there so the underlying
slowness — whatever it is — can be named rather than inferred from fence timestamps.

**What the overseer did and did not do.** It engaged on every one of these issues, twice each, and on
`p3-input-assist` it escalated with `cause: harness_defect` and a correct reading of the evidence. That is the role
working as designed. What it could not do is fix the harness, and its rounds were consumed by the very defect it was
diagnosing, so the owner still saw four tasks. The harness now prevents the fence, which is where the fix belongs.

## `reconcile-completion` verifies the run branch, not `main` (2026-11-03)

Escalation-path work is the one case the harness is designed never to merge itself: `_on_implementer` fails the attempt
and asks the owner, and `merge_gate` refuses a second time. The supported way such work still reaches `Done` is
`reconcile-completion`, which checks a merged pull request at GitHub and then journals ordinary transitions.

It could not succeed for any real run. `_base_branch` returned `policy.base_branch` (`main`) while
`runner.build_scheduler` publishes every issue pull request against `policy.run_branch`
(`harness/run/<plan>`, set by `DEFAULT_POLICY`). A correctly merged issue pull request was rejected with *PR base branch
does not match the configured base branch 'main'*, and the required checks were read from the wrong branch's rules. The
function's own docstring already said "the run branch when the plan uses one"; only the code disagreed. It now returns
`run_branch(plan) or base_branch(plan)`, so the branch whose rules are verified is the branch the work actually landed
on. Nothing was relaxed: a pull request that bypassed the run branch is still refused, and the review, check, head,
repository and merge-commit evidence are unchanged.

The known limit above still holds for the rest of the flow: the scheduler does not notice a human merge by itself, and
`reconcile-completion` refuses while the issue still has an open human task, so the owner answers the decision task
first and records the merge afterwards.

## Phase gates restrict admission in branching plans (2026-11-03)

`pause --after-phase P` previously stopped only after P finished, while independent sibling phases could already
start and unlock later work. An armed gate now admits new activation, dispatch, phase exit checks and integration
only in P and its transitive prerequisites. Already-completed phases remain admitted as history. Existing workers
drain, but out-of-gate work waits for a later gate before integration. Without a gate, independent phases still run
concurrently. An unresolvable gate pauses explicitly rather than admitting the whole plan.

A paused plan can pre-arm its next gate before `resume`, avoiding a first-tick race. The phase is validated against
the signed plan even before its state exists; unknown or already-completed targets are refused. Pre-arming does not
resume execution or change the approved plan, budgets, models or evidence requirements.

## A plan can sign its refiner instead of always paying for the strong tier (2026-11-03)

Role routing pinned the refiner, but three places still forced that pin to be a `strong` model:
`plans.validate_plan` refused any `model_routing.refiner` outside the strong band, `models.REQUIRED_TIER`
upgraded a cheaper refiner choice, and dispatch asked `resolve_model` for the `strong` tier, which then found
nothing inside the one-model routed menu and blocked the attempt. An owner who wanted routine refinement on
Sonnet had no way to say so, even though Sonnet was already approved in `model_tiers`.

A refiner named in `model_routing` is now read as a signature: `models.signed_refiner` resolves it to the band
it is approved at and `models.resolve_signed` dispatches exactly that model — no tier upgrade, no substitution,
no runtime-default fallback. The signature also wins over a per-issue `model_choices.refiner` recorded under an
earlier plan version, so switching the refiner is a new plan version and no attempted issue or its evidence is
rewritten.

Nothing was widened. The floor for a signed refiner is `standard`: a `low` selection, or one outside
`model_tiers`, is refused by plan validation and again at dispatch. A signed model the runtime does not offer
blocks the issue (`model selection rejected`) instead of falling back. Plans without `model_routing` keep the
`REQUIRED_TIER` strong refiner and its upgrade-with-a-note behaviour, the overseer's strong floor, the model
catalog and tier bands, the routine/escalation menus and reviewer independence are unchanged, and changing the
signature still requires a new plan version and personal approval.

## A plan that writes an owner-merged file is held, not handed to an implementer (2026-11-03)

Three times in the iOS/Android run a refinement planned an edit to an escalation path, an implementer was
dispatched to carry it out, and the trusted diff gate refused the result: `lesen-capacitor-8-upgrade#2`,
`lesen-offline-bundle#2` and `lesen-parent-report#2` (`sites/lesen/package.json`, adding
`@capacitor/filesystem` and `@capacitor/share`). The gate did its job every time — nothing was merged and no
repair budget was spent — but the cost was a paid implementer attempt and an owner round trip per occurrence,
and the prompt rule the refiner broke ("do not plan edits to these files; report `needs_input`") was enforced
nowhere in trusted code.

The refiner now declares the files its plan writes in `plan_files`, and `_on_refiner` holds the plan when
`broker.planned_escalation` — the same matcher the diff gate uses, applied to the task's working directory —
finds an owner-merged file among them. The issue blocks with the prerequisite stated and the files named, the
plan is stored so the owner can read what was asked for, the refinement stays a success, and no implementer is
started.

Nothing was widened and no policy changed. The diff gate, the escalation path list, the merge gates, routing
and every budget are untouched; this only stops work earlier than the gate already stopped it.

**Known limitation, accepted deliberately.** `WORKER_RESULT.plan` is a list of free-text steps, and the real
plans show why that cannot be parsed: protected files appear in them as instructions *not* to edit
("do not edit sites/lesen/package.json, which is owner-merged"), as cleanup ("reverting any package.json or
package-lock.json dependency-pin churn"), and as prerequisites already merged by the owner. Classifying those
by text would need negation and sentiment, so the guard reads only the structured declaration. A refiner that
plans a protected edit and declares nothing is therefore still caught by the diff gate, as before — the
previous behaviour, unchanged. Making `plan_files` mandatory for every refinement would close that gap and
would be a worker-contract change worth a separate decision.

## The plan declaration became a contract instead of an optional extra (2026-11-03)

The first version of the guard above read `plan_files` when a refiner happened to send it and accepted the
refinement silently when it did not, so the recurring failure it was built for stayed open: the refinement that
cost `lesen-parent-report#2` would have passed by simply omitting the field. It also read only the first 50
declared paths and truncated each to 400 characters, so a protected file at index 51 was classified as absent —
a silent bypass in the one list whose purpose is to surface it.

A refiner dispatch now records the contract it was issued under in the attempt (`result_contract`, currently
`plan_files/1`). A `ready` result under that contract must declare `plan_files`; `[]` is valid and means the
plan writes nothing. Omitting it, declaring more than `MAX_PLAN_FILES` paths, or declaring an empty one is
rejected through the existing `schema_invalid` path, which fails the attempt, carries the reason into the next
refiner packet as `your_previous_answer_was_rejected`, and stops the implementer from being dispatched on a plan
trusted code could not read. Every declared path is now classified; nothing is truncated.

The marker lives in trusted dispatch metadata rather than in the result, so compatibility is explicit instead of
accidental: an attempt recorded without it — history, or a worker in flight across the upgrade — keeps the old
behaviour, and a worker cannot opt out of the contract by leaving a field out. Nothing else moved: the diff gate,
the escalation path list, the merge gates, routing, budgets and issue guidance are untouched, and a contract
failure spends the ordinary repair budget rather than any override.

**Cost accepted.** A refiner that never emits `plan_files` now exhausts its repair attempts and raises a decision
task naming the contract, where before it would have been implemented and stopped later by the diff gate. That is
the point of the change, and the prompt states the requirement, but it does make refinement depend on a model
following one more instruction.

## The sandbox checks the shape of an iOS app and never builds one (2026-11-03)

An iOS build needs macOS, Xcode, and signing material. None of that belongs in a Linux worker sandbox, and none
of it may be given to a worker, so the macOS release workflow stays the only build authority: it is the only
place that compiles, signs, and uploads. What the sandbox *can* do without a toolchain is read the app the way a
reviewer reads it, which is where the expensive mistakes live. `worker/smoke/ios_shell.sh` (trusted, baked into
the image, Python standard library only, no network) is therefore a shape check, not a build:

* `capacitor.config.json` must carry a reverse-DNS `appId` and a relative `webDir`, and must not set `server.url`
  or `server.cleartext`. A webview pointed at a remote server is the rejection the whole offline app exists to
  avoid, and it is one line in a config file.
* `Info.plist` and `PrivacyInfo.xcprivacy` must parse as property lists, the manifest must declare
  `NSPrivacyTracking=false`, empty tracking domains, no tracking data type, and one reason code per required-reason
  API under `NSPrivacyAccessedAPITypeReasons`. Apple reads that key; the shortened `NSPrivacyAccessedAPIReasons`
  spelling parses as a plist, ships, and is ignored, so the rule names it explicitly instead of passing it.
* The manifest file existing is not evidence that it ships: the check reads the `PBXResourcesBuildPhase` of the
  Xcode project and fails unless `PrivacyInfo.xcprivacy` and the web-asset folder are actually bundled.
* `Info.plist` must declare exactly `de` and `en`: the app is bilingual, and a wrong localization list is a
  store listing defect no test on the device would show.
* The bundle must be offline and complete: nothing may be *loaded* over the network from HTML, CSS, bundled
  JavaScript, or an inline `<script>` — which is where most of this app's code lives — every local reference and
  module specifier must exist, and the only remote links allowed are the reviewed navigation targets (the imprint
  and the supervisory authority the privacy policy must name).
* Completeness is a named inventory, not a reference scan. The app loads vocabulary, sentence data, and licence
  files by names it builds at run time, so a scan that follows only literal references passes a bundle with no
  words in it. The 29 required files are listed in trusted code, mirroring `REQUIRED_FILES` in the product's
  `scripts/verify-bundle.mjs`, which is read for its inventory and never executed: it is worker-editable, so it
  can inform the trusted list but cannot be the authority. A test fails when the two drift.
* Every bundle that exists is checked — the source `static/`, the copied `www/`, and the generated
  `ios/App/App/public/`. Checking only the first would let a stale generated copy hide a source that changed
  under it, which is the failure mode a build step makes easy.

It fails closed. Once `sites/lesen/ios/` exists, a missing or unreadable `Info.plist`, privacy manifest, or
`project.pbxproj` is a failure rather than a skip. Before the shell exists — and in repositories that have no
Capacitor project at all — the rule checks the configuration and says so, so Android-only and web-only phases
keep working and a legacy repository is not failed by a check for something it does not have.

The matching escalation entries stay narrow on purpose: `Info.plist`, `PrivacyInfo.xcprivacy`, `project.pbxproj`,
`*.entitlements`, and the signing material (`*.p12`, `*.mobileprovision`, `*.p8`, `*.cer`) are owner-merged, while
the Swift sources and the SPM manifests `cap sync` rewrites are not. Escalating `sites/lesen/ios/` as a whole
would make an iOS plan unexecutable, which is a worse answer than a reviewed list.

**Cost accepted.** The rule is only as good as its list: a privacy key Apple adds later, or a way to reach the
network the scanner does not model (a template literal built at runtime, a plugin that fetches on its own), passes
it. It proves the shape, not the behaviour — the device evidence stays a manual test — and adding the script to
the image invalidates the Tier A attestation until `harness isolation build` and `isolation verify` have run.

## A run document is changed in one transaction, never written back from a snapshot (2026-11-04)

`pause` looked broken in the first Arithmo Slayer run: the operator was told the pause was requested, a worker was
dispatched right after, and `run_state` showed no `pause_requested` at all. The request had been made, and then
silently erased. `_implementation_checked` read the run document before `open_pr` — a network call that can take
seconds — and wrote its snapshot back afterwards to bump `prs`, putting the pre-pause document over the request.
Any writer holding a dictionary across a slow call can lose the same way: a check lease renewal, a promotion, a
cancel.

`Store.update_run(plan_id, mutate)` reads, mutates, and writes inside one `BEGIN IMMEDIATE` transaction, and every
run-document writer in `scheduler.py` and `runner.py` now goes through it. The lock is short and per-writing-runner,
so the cost is one small transaction where a write already happened, and the operator's request can no longer be
overwritten by a stale copy. The regression test pauses inside `open_pr` and would have failed before this: it
asserts that the `prs` bump and the `pause_requested` flag are both present afterwards, and the run then stops.

A field that must never be lost still needs a writer that respects it: `update_run` prevents a lost update, not a
deliberate clear. `start()` may clear the pause flags because a resumed run is a new run; nothing else may.

## An imported issue may arrive pre-planned (2026-11-04)

Refinement is the plan's most repeated cost, and the Arithmo Slayer run shows why it is not always worth paying: of
twelve refiner passes, **ten were re-plans after anchor churn** (`_stale_anchors`) and only two were the first plan
of a task. A documentation issue that writes one Markdown file gains nothing from that pass and still pays for the
strong tier, which the harness refuses to lower (`SIGNED_REFINER_FLOOR`).

`tier_fit` is now accepted on an imported issue, because it is exactly the statement a refiner makes: the tier the
work fits. `_needs_plan` already skips an issue that declares one, so the plan's author — inside a plan the owner
approved — can say "no plan pass is owed" for the work that does not need one. The value is validated against the
known tiers at import, it is part of the issue definition, so an unchanged re-import stays a no-op, and a bad value
is refused rather than ignored.

What this does *not* do is make planning cheaper in general. `model_routing` still forces a plan pass on every issue
when it is set, and a signed refiner below the standard band is still refused, so a DeepSeek-only plan cannot route
refinement to `deepseek-flash`. The cheaper levers that remain are volume, and they belong to whoever writes the
plan: fewer, larger issues; documentation exempt from planning; and issues whose anchors are stable, because every
issue that edits the same file after an earlier merge buys another re-plan.

## The investigator keeps what it read, per commit (2026-11-12)

Every investigator attempt re-read the repository from scratch, so a rejected draft costs ten to fifteen minutes of
reading that the next attempt repeats almost unchanged. The Arithmo Slayer web run showed this three times in a row:
two drafts failed a shape check and one stalled, and each retry re-read the same clone.

`tools/harness/repocontext.py` now caches that reading. An entry is a compact, owner-reviewable summary of the
repository (layout, module roles, commands the agent actually ran, traps), plus the tracked-file index, produced by
the agent and trimmed here to fixed caps. Reuse is decided by trusted code, not by the model: the cache key is the
base commit, the requirements text and the prompt hash, so a moved base, an edited requirement or a changed prompt
never reuses an old reading. An entry is stored after any attempt that returns a shape-valid draft — a rejected plan
still read the code — and is injected into the next attempt and into later runs of the same requirements.

The trust boundary is unchanged: the summary is model-written text, so the prompt tells the agent to trust the code
over the notes, and the owner still approves the plan. What the cache buys is the orientation pass, not the decision.

Two related repairs came from the same run. A list-valued key answered with one prose string no longer rejects the
draft (the string is wrapped into a one-element list and logged); and a new-file `code_anchor` missing from its
phase allowlist now adds exactly that path (repository-relative, non-existent, not harness-protected) instead of
rejecting the phase. Both only ever widen what the plan already declared, and both are covered by tests. The prompt
also forbids unbounded recursive reads now, because a shell call with huge output was the failure mode that stalled
two attempts.
