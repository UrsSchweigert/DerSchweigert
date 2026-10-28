---
title: Harness Specification
description: Runtime requirements for the GitHub-backed incremental development harness with one plan approval, human escalation, and run monitoring
ms.date: 2026-10-26
---

## Overview

The harness runs approved, phased work on an existing repository. Agents propose and perform bounded work. Trusted code owns authorization, scheduling, state transitions, validation, and GitHub mutations.

Agents assess semantic correctness and scope drift. Code enforces the evidence and authorization rules and never claims to prove either. Do not claim guarantees that the available runtime or permissions cannot enforce.

Related documents: [security model](security-model.md), [state machines](state-machines.md).

## Commands

Provide commands equivalent to these operations using the repository's toolchain:

* `plan`: Analyze supplied requirements against the existing implementation and tests, and propose a complete phase plan.
* `approve`: Record human authorization of an identified plan version and execution policy.
* `run`: Execute all eligible work within that authorization.
* `status`: Reconcile and report business state and live execution state. Read-only.
* `resume`: Recover interrupted execution from GitHub and runtime state, not chat history.
* `respond`: Validate a human-task response and resume eligible dependent work.
* `cancel`: Stop scheduling and safely terminate or drain active work.
* `reconcile-completion`: Verify merged PR and CI evidence for work completed outside the runner, then record it through normal issue transitions.

Command rules:

* Every command that writes remotely supports `--dry-run`, which reads only and prints the intended writes.
* `status` supports `--json` for machine-readable output.
* VS Code hooks and prompt files are thin entry points into these commands and may perform tool checks. They are neither the scheduler nor a security boundary.
* Schema-validate every task packet, action proposal, and worker result.
* Reject illegal state transitions in code regardless of what an agent requests.

## Runtime Process

Unattended operation needs a running scheduler and worker runtime. A VS Code chat session is not a persistent service.

* `run` is a foreground, restartable process. Document how to run it under a supervisor if the user wants it detached.
* When the runner stops, leases expire, workers are fenced, and no work is marked complete by absence. `resume` reconciles GitHub and runtime state, including unfinished claims and branches, before scheduling.
* Hand a worker only what it needs: issue scope, approved constraints, code anchors, dependencies, and validation commands.

## GitHub Work Record

GitHub is the durable business record. Reuse one appropriate GitHub Project, or propose one for creation after approval. Do not duplicate equivalent existing artifacts.

### Artifacts

* A requirements tracking issue with source references, stable requirement IDs, clarifications, decisions, the approved plan version, and coverage links.
* A milestone and phase tracking issue per phase, recording outcome, scope, dependencies, exit criteria, work links, and current progress.
* Implementation issues or sub-issues linked to requirements, their phase, and PRs.
* Human-task issues linked to the work they block.

### Conventions

* Use native sub-issues and dependencies when supported. Otherwise use explicit links with equivalent harness-managed semantics.
* Keep Project fields minimal: status, priority, phase, size, and parallel-safety where useful.
* Use implementation statuses `Inbox`, `Refining`, `Ready`, `In Progress`, `In Review`, `Blocked`, and `Done`. Transitions are defined in [state machines](state-machines.md).
* Keep current scope, acceptance criteria, and checklists in issue bodies. Wrap harness-managed content in a marker block carrying a stable identifier and checksum.
* Record significant starts, blockers, review handoffs, decisions, and completion evidence in concise issue comments. Do not upload agent transcripts or stream telemetry into comments.
* Synchronize Project fields with actual work, PR, review, and CI state.
* Search before creating anything and attach stable identifiers to prevent duplicates.
* Make partial remote writes recoverable and retries idempotent. Surface pending synchronization instead of claiming success.
* Back off on rate limits and secondary rate limits, honoring `Retry-After`.
* Do not create competing local progress documents.

### Validation and external completion

* Validation commands run in the actual worker-check image with the repository mounted at `/work`. An optional `working_directory` is repository-relative; absolute or escaping working directories are invalid.
* Before plan approval, the CLI runs phase validation commands in that image and stores results bound to the plan digest and source revision. Configuration errors such as missing executables, invalid directories, or nonexistent absolute paths prevent approval. Issue-specific command overrides are preflighted before issue import.
* Configuration failures stop the issue and raise an operator task; they are not implementation defects. Identical command-and-error signatures on an unchanged revision stop retries. Repair usage remains cumulative; an operator must select the explicit one-attempt budget extension to go beyond the configured repair budget.
* Before dispatch and immediately before merge, read effective branch rules and classic protection. Report concrete blockers and fail closed when rules cannot be verified.
* `reconcile-completion` may record work performed outside the runner only after fetching the PR, head and merge commits, required check results, and available review evidence from GitHub. It journals the operator and source references, uses legal issue transitions, and never creates agent review evidence. Phase and plan completion remain subject to their ordinary validation and lifecycle rules.

### Authority

Each datum has one source of truth. This prevents split-brain between GitHub and runtime storage.

* Approved scope and policy digest: the approval record in harness state. A mismatch halts execution and is never auto-corrected.
* Requirements, phases, issue scope, and acceptance criteria: the harness-managed block in GitHub issue bodies. The harness validates edits against the approved plan and ignores edits by non-allowlisted authors, reporting them.
* Issue and Project status: GitHub. The harness reconciles status to PR, review, and CI state and preserves a human-set `Blocked`.
* PR, review, and CI state: GitHub, re-fetched per head revision and cached only against that revision.
* Claims, leases, attempts, retry counts, and the execution journal: the private runtime store. GitHub never overrides these.
* Human-task responses: an authenticated GitHub interaction or a trusted local command, validated before the task resolves.

## Plan and Approval

Compare requirements with the existing implementation and tests before planning. Identify existing coverage, gaps, ambiguity, risk, and necessary changes.

Propose phases that deliver demonstrable increments, ordered by dependencies and risk. Each phase needs:

* Outcomes
* Requirement coverage by ID
* Scope, including the path allowlist the phase may touch
* Non-goals
* Dependencies
* Exit criteria
* Validation strategy

Keep future implementation detail coarse. Refine issues when their phase becomes eligible.

### Approval

The only routine human approval is approval of the complete phase plan together with its execution policy. Present both before requesting it.

* Bind approval to a versioned, immutable scope and policy digest.
* Hash the requirement IDs and sources, the phases (outcomes, scope, path allowlists, non-goals, dependencies, exit criteria, validation strategy), and the execution policy (authorized operations, escalation paths, merge policy, budgets).
* Do not hash statuses, progress, implementation issues, acceptance-criteria refinements within a phase, code anchors, or comments.
* Validate approval through a trusted human interaction and record approver, timestamp, plan version, digest, and authorized operations. Agents cannot approve plans.
* Approval authorizes in-scope issue and Project updates, isolated branches, commits, pushes, PR creation, and eligible merges across every approved phase.
* Do not ask for routine issue, phase-start, PR, merge, or phase-end approvals.
* Preserve required external reviews, branch protections, platform permissions, and organization policy. Record such blockers rather than bypassing them.
* General plan approval does not authorize production deployment, new paid services, credential changes, destructive actions, or protection bypasses.
* When approved outcomes, scope, or permissions change, invalidate only the affected authorization and request approval of that revision. Unaffected phases keep their authorization.
* Permit in-scope clarifications, issue splitting, and refinement without another gate. Escalate suspected scope changes as human tasks rather than accepting them silently.

## Scope and Risk Controls

Code cannot prove the absence of scope drift. It can enforce deterministic proxies, and the coordinator must apply all of them:

* Every implementation issue references requirement IDs and exactly one phase from the approved plan.
* Changed paths stay inside the phase path allowlist.
* Diff size stays under the configured cap.
* No new dependency, workflow file, or permission change appears unless the plan authorizes it.

A violation blocks the work and raises a human task instead of auto-accepting.

### Escalation Paths

Changes touching these paths are never merged autonomously. They require a human task even under an approved plan, unless the approved execution policy explicitly removes a path:

* CI and workflow configuration
* Harness code, policy, and trusted validation configuration
* Authentication, secrets, and permissions
* Dependency manifests and lockfiles
* Database migrations and infrastructure definitions
* Branch protection and repository settings

### Independent Review

A reviewer is independent only when all of these hold:

* It runs in a separate session without access to the implementer's context.
* It receives only the diff, the issue scope, and the actual validation results.
* It uses a different model from the implementer when one is available.
* Its verdict is structured and bound to the head revision.

The implementer never reviews its own work.

## Execution Loop

Provide bounded investigator, refiner, implementer, reviewer, and integrator roles. The coordinator is trusted code and owns scheduling and authoritative state changes. Combine roles where separate calls add no value, but keep review independent of implementation.

Use subagents and cheaper suitable models only where genuinely supported, following the Model Selection section. Do not assume nested agents, background execution, or model routing.

Execute this loop in code after approval:

1. Reconcile plan authorization, dependencies, GitHub state, PRs, and CI.
2. Select eligible phases and refine only enough near-term work to stay productive.
3. Create bounded implementation issues with outcomes, requirement IDs, acceptance criteria, non-goals, code anchors, dependencies, contracts, and validation commands.
4. Mark an issue `Ready` only when it is actionable and free of blocking ambiguity.
5. Claim ready, unblocked issues through the scheduler before dispatching workers, after the refinement-freshness check in Keeping Work Current.
6. Use isolated branches or worktrees and isolated execution environments. Parallelize only stable, independent work and land shared contracts first.
7. Run focused checks, required repository checks, and independent review. Repair findings within the configured attempt and execution budgets.
8. Bind review and test evidence to the actual revision under consideration. Invalidate stale evidence, apply the base-drift rules in Keeping Work Current, and obey merge-queue and protected-branch requirements.
9. Merge eligible PRs in dependency order, then verify integrated behavior. Mark work `Done` only after integration and required checks succeed.
10. Validate phase exit criteria and requirement-to-verification coverage, close completed phase artifacts, and advance to the next eligible phase.

Continue until approved work is complete, cancelled, or no further work is eligible. Workers may propose follow-ups, but the coordinator accepts only work within approved scope. Never mark work complete because code exists or a PR opened.

After a failure, apply Failures and Retries. Make all limits configurable before execution. Do not retry indefinitely or repeatedly ask a model for the same answer.

## Failures and Retries

Code assigns a failure class to every terminal non-success attempt from evidence. The agent's own account of why it failed is not evidence.

* Transient: runtime or infrastructure errors, network failures, rate limits, and a first timeout for a task packet.
* Deterministic: failing required checks, review findings, schema-invalid worker results, merge conflicts the worker could not resolve, and a timeout that repeats for the same task packet.
* Policy: scope-drift violations, escalation-path changes, approval or permission failures, and protected-branch rejections.
* Unknown: treat as deterministic.

Budgets by class:

* Transient failures retry with exponential backoff and jitter up to the transient retry limit. They do not consume the repair budget.
* Deterministic failures get the automatic repair attempts. Each retry must change an input: add the new failure evidence to the task packet, narrow the scope, or move up a tier as Model Selection allows. The coordinator rejects an attempt whose task-packet digest and tier match a failed attempt.
* Policy failures are never retried. Block the issue immediately.
* Compromised isolation, invalid credentials, or exhausted global budgets are systemic failures and pause the project instead.

When a budget is exhausted, block the issue with the failure evidence and continue other eligible work.

### Blocked Work Has an Owner

Every `Blocked` issue has either an unmet dependency on other work or an open human task. When the coordinator blocks an issue for exhausted retries or a policy failure, it raises a decision task containing:

* The failure evidence and the attempts made, each with its failure class
* Options: refine the scope, supply guidance or an asset, accept a different approach, or cancel the issue

Reconciliation checks this invariant on every pass. It creates the missing task for any `Blocked` issue that has neither a dependency nor a task, and `status` reports the repair.

## Keeping Work Current

Work goes stale when its inputs change underneath it. Code detects each case deterministically instead of relying on an agent to notice. Each attempt also starts from a fresh task packet and never from chat history. Worker liveness, leases, and fencing are defined under Monitoring and Notifications.

### Refinement Freshness

* Record the base revision when an issue is refined and when it becomes `Ready`.
* When the scheduler claims an issue and the base has moved, compare the issue's code anchors and dependency contracts between the recorded revision and the current base.
* If an anchor path changed or disappeared, or a dependency contract changed, return the issue to `Refining` for a `low` tier refresh instead of dispatching a worker.
* If nothing relevant changed, claim the issue as normal.

### Base Branch Drift

* Before review and before merge, bring the branch up to date with the base in its isolated worktree.
* Compare the patch identity of the branch diff before and after, for example with `git patch-id`. An unchanged identity means the rebase was clean, so the existing review verdict remains valid for the new head.
* Always rerun required checks on the up-to-date head, because the base changed even when the diff did not.
* When the patch identity changes or the rebase conflicts, invalidate all evidence and return the issue to `In Progress` as a repair attempt that counts against the deterministic budget. Then rerun checks and independent review on the new head.
* Merge only a head whose checks passed on top of the current base, or let the platform merge queue verify it, and record which applied.
* Rebase dependent issues onto merged contracts before their next check.

## Model Selection

Model choice is an execution-policy setting, so the approval digest covers it. Pick the cheapest tier that the task packet supports and move up only on evidence.

* Define three tiers in the policy: `low`, `standard`, and `strong`. Map each tier to a concrete model in `docs/harness/decisions.md`, because the available models depend on the runtime.
* Default role mapping: investigator and refiner use `low`, the implementer uses `standard`, the reviewer uses `standard`, and the integrator uses `low` because its merge, check, and sync steps are deterministic code.
* The reviewer never runs below the implementer's tier and uses a different model from the implementer when one is available.
* Escalate by evidence. Move one tier up for a repair attempt only after a failed check or review finding on the previous attempt. Use `strong` for work touching an escalation path. An agent's request for a stronger model is a proposal that the coordinator accepts only on these grounds.
* Cap `strong` usage with its own attempt budget per issue.
* Do not call any model for a task that a script or CI can do.
* Route to a cheaper tier only when the task packet is small, bounded, and its output is schema-validated.
* Record the model and tier for every attempt in the journal.
* When the runtime has no model routing, run every role on the single available model, record "model routing unavailable" in `docs/harness/decisions.md`, and show it in `status`. Do not pretend the tiers apply.
* Report usage per role and per tier where the runtime supplies it. Where it does not, record estimates, label each by its source (an agent's own estimate, or a size-based lower bound), never use them for limits, and show cost only from prices the owner supplies.

## Human Tasks and Manual Testing

Represent human input as a dependency, not another general approval gate. Support typed requests for an asset, a decision, or manual GUI validation.

Each human task contains:

* The specific request and why it matters
* Affected issues
* Owner
* Response format and resolution criteria
* Relevant options
* Any deadline

Make each task answerable without reading agent transcripts. Batch related questions. States and transitions are in [state machines](state-machines.md).

* Attempt bounded, authorized recovery before requesting human intervention.
* Persist and notify on the request, block dependent work, and release waiting workers. Continue unrelated work without token-consuming wait loops.
* Deduplicate notifications and use bounded reminders and escalation deadlines. Silence never means consent or a passing test.
* Validate responder identity, required answers or artifacts, accessibility, and revision applicability before resolving the dependency and resuming work.
* Accept responses only through authenticated GitHub interactions or a trusted local command. A worker-generated comment cannot impersonate human input.
* Keep passwords, tokens, and sensitive artifacts out of issues and logs. Request secret configuration through an appropriate external channel.
* Reserve project-wide pauses for systemic failures such as invalid credentials, compromised isolation, exhausted global budgets, or unavailable required services.

### Manual GUI Testing

Allow manual GUI testing under an explicit validation policy when visual judgment, physical devices, native dialogs, restricted environments, or a one-off interaction make human execution more efficient than Playwright. Agents can recommend this route. The harness decides whether it satisfies the validation requirement.

* Include build or preview reference, exact commit, environment, device or browser, preconditions, test data, steps, expected outcomes, and required evidence.
* Capture tester identity and a structured result of `pass`, `fail`, or `inconclusive`.
* Bind results to the tested revision. Invalidate them after changes that could affect tested behavior, and default to invalidation when impact is uncertain.
* Return failed tests to repair and leave inconclusive tests unresolved.
* Never silently replace mandatory automated checks or excuse failures as manual testing. Preserve automated coverage for repeatable logic and critical regressions.
* Consider automation for checks repeated often enough to justify its cost.

## Asset Generation

Blender is an optional capability for producing or sourcing assets such as 3D models, textures, HDRIs, sprites, and preview renders. It is bounded, authorized recovery that runs before an asset human task. Without Blender, every asset need becomes a human task as described above. Install and connection steps are in [Blender setup](blender-setup.md). Execution rules are in the Blender Access section of the [security model](security-model.md).

### Asset Policy

The execution policy sets the following, and the approval digest covers them:

* Allowed sources. Default: existing repository assets, CC0 libraries such as Poly Haven, and procedural modeling by script.
* Allowed licenses. Default: CC0 only. Any other license must be listed in the policy and needs an attribution record.
* Paid generation budget in credits. Default: zero, which disables AI model generation. General plan approval never authorizes new paid services, so a nonzero budget must be named in the policy.
* Per asset class: accepted formats, maximum file size, triangle count, texture resolution, and bounding-box limits.
* Output directory and naming convention.

### Asset Flow

1. A worker proposes an asset request with purpose, issue, format, limits, style notes, license policy, and output path. Workers never call Blender directly.
2. The broker validates the request against policy and runs it through the Blender runner. Source order is existing repository assets, CC0 library search and import, procedural modeling by script, and AI generation only when the policy grants budget.
3. The runner exports the asset in the required format to the output path and writes a manifest entry.
4. Code validates the result deterministically.
5. The independent reviewer inspects preview renders. When the policy marks visual fit as needing human judgment, raise a manual-validation human task with the previews attached.
6. Raise an asset human task when Blender is unavailable, the budget is exhausted, validation fails twice, or no allowed source fits. Include the request, the sources tried, and the reasons.

The manifest entry records asset path, checksum, request ID, issue, source, source ID and URL, author, license, attribution line, tool and versions, generator and prompt or script reference, and date.

Deterministic validation checks:

* The file exists in an allowed format and meets the size, triangle, texture, and bounding-box limits.
* The license is allowed by policy, and attribution is recorded where required. Unknown or ambiguous licenses are rejected and escalated.
* The checksum matches the manifest.
* Exported files contain no absolute paths, credentials, or embedded scripts.

Keep the Blender script for procedurally modeled assets next to the manifest so they can be regenerated. AI-generated assets are not reproducible, so record the generator and prompt and mark them nondeterministic. Report generation credit usage only when the provider supplies it, and label it unavailable otherwise.

## Monitoring and Notifications

Provide a read-only CLI status interface and a small dashboard or existing equivalent. The CLI is required. The dashboard is optional and must not add a second source of truth. Show live execution without making GitHub comments a telemetry stream.

The interface shows:

* Phase progress, requirement coverage, queue state, dependencies, and blockers
* Each worker's role, issue, run ID, branch, revision, elapsed time, retry count, last activity, and latest outcome
* Runner health, heartbeats, expired leases, pending synchronization, failures, validation evidence, review state, and integration state
* Human requests, owners, age, deadlines, and affected work
* Actual usage and costs where available, configured budgets, and remaining allowance. Label unavailable metrics as unavailable, label estimates as estimates with their source, and never invent prices.

Telemetry rules:

* Emit structured events with plan, phase, issue, attempt, and run identifiers.
* The runner owns heartbeats and process health. Do not rely on agent self-reporting.
* Distinguish process liveness from meaningful task activity and durable progress.
* Implement configurable inactivity and execution timeouts. Reconcile state before restarting stalled work and fence expired workers against further privileged writes.
* Notify on human requests, terminal failures, budget thresholds, and phase outcomes, not on every heartbeat.
* Store sanitized diagnostic events with bounded retention. Exclude secrets and raw transcripts.

## Context and Cost Bounds

* Keep always-loaded instructions short and load specialist workflows on demand.
* Pass workers only issue scope, approved constraints, relevant code anchors, dependencies, and validation commands. Avoid repository dumps and full histories.
* Require compact handoffs: outcome, changed files, revision, actual check results, risks, blockers, and next action.
* Use scripts and CI for deterministic tasks rather than additional model calls.
* Reuse verified facts only while their source revisions remain applicable.
* Configure concurrency, runtime, retry, and usage budgets. Subagents are not automatically cheaper. Delegate only where isolation or specialization helps.
* Persist enough state for recovery without growing duplicate narrative logs.

## Defaults

Use these values unless `docs/harness/decisions.md` overrides them. All are configurable before execution.

| Setting                               | Default                                                                                             |
|---------------------------------------|-----------------------------------------------------------------------------------------------------|
| Concurrent workers                    | 2, only for issues marked parallel-safe                                                             |
| Automatic repair attempts per failure | 2                                                                                                   |
| Strong-tier attempts per issue        | 1                                                                                                   |
| Transient retries per failure         | 3, with exponential backoff and jitter, not counted against repair attempts                         |
| Worker execution timeout              | 30 minutes                                                                                          |
| Worker inactivity timeout             | 10 minutes                                                                                          |
| Runner heartbeat interval             | 30 seconds                                                                                          |
| Lease duration                        | 90 seconds, renewed only by the runner heartbeat                                                    |
| Human task reminders                  | After 24 hours, at most 3                                                                           |
| Human task escalation deadline        | 72 hours, then notify the secondary owner                                                           |
| Run wall-clock budget                 | 8 hours                                                                                             |
| Pull requests per run                 | 20                                                                                                  |
| Token and cost budget                 | Runtime-reported usage when available, otherwise unavailable and bounded by attempts and wall-clock |
| GitHub write retries                  | 5, with exponential backoff and jitter, honoring Retry-After                                        |
| Diagnostic event retention            | 14 days                                                                                             |
| Autonomous merge                      | Only when every merge gate passes and no escalation path is touched                                 |
| State store                           | SQLite file outside worker-writable paths                                                           |
| Approval mechanism                    | Local terminal confirmation by the repository owner, written as a signed approval record            |

## Required Tests

Use test doubles for fault injection and label them as doubles, distinct from real integrations. Each group below must have focused automated checks by the stage shown.

| Group                    | Required checks                                                                                                         | Stage |
|--------------------------|-------------------------------------------------------------------------------------------------------------------------|-------|
| Authorization            | Unapproved execution, forged approval, changed plan or policy digest, illegal transitions                               | 2     |
| Claims and recovery      | Duplicate claims across runners, stale leases, fencing of expired workers, crash recovery                               | 2     |
| GitHub sync              | Idempotent creation, partial writes, restart reconciliation, pending-sync reporting                                     | 3     |
| Broker isolation         | Workers cannot reach credentials, policy, approval records, or trusted validation config                                | 3     |
| Untrusted content        | Edits by non-allowlisted authors ignored, injected instructions never alter policy                                      | 3     |
| Scheduling               | Cancellation, retries and attempt budgets, bounded concurrency, heartbeat loss, stalled execution, exhausted budgets    | 4     |
| Model routing            | Tier per role applied, evidence-only escalation, reviewer not below implementer tier, no-routing fallback reported      | 4     |
| Failures and retries     | Failure classes assigned by code, separate budgets, duplicate-attempt rejection, blocked issue always has an owner      | 4     |
| Staleness                | Ready issue refreshed when anchors change, patch-id evidence rule, rebase conflicts, checks rerun on new base           | 4     |
| Evidence and integration | Stale reviews or results, failed checks, protected merges, premature completion, scope-drift and escalation-path checks | 4     |
| Human tasks              | Notification deduplication, responder identity, invalid responses, automatic resume                                     | 5     |
| Manual testing           | Missing assets, stale results, inconclusive results, manual tests never replacing mandatory automated checks            | 5     |
| Asset generation         | License and paid-generation policy enforced, size and polygon limits, provenance manifest complete, no-Blender fallback | 5     |
| Telemetry                | Sanitized events, bounded retention, unavailable metrics labeled as unavailable                                         | 5     |

Demonstrate scheduling, escalation, status, and recovery in dry-run mode without remote writes. If no product requirement is supplied, use a clearly labeled test fixture rather than inventing product scope. Validate the real runtime adapter through a safe read-only probe where authorized and available.
