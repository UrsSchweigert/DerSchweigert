---
title: Harness manual
description: Operating, verifying, and safely upgrading the incremental development harness
ms.date: 2026-10-28
---

## Overview

The harness plans, approves, and runs phased development work on this repository. You describe what you want in a requirements file. An investigator drafts a plan, you approve it once, and AI workers then build it issue by issue inside a Docker sandbox. Trusted Python code (not the AI) decides what is allowed, what counts as done, and when something is merged.

This manual is for the person operating the harness. Design and requirements are in [docs/harness/](../../docs/harness/spec.md). Choices, limits, and the history of fixes are in [decisions.md](../../docs/harness/decisions.md).

## Contents

1. [How it works](#how-it-works)
2. [One-time setup](#one-time-setup)
3. [Quick start](#quick-start)
4. [Everyday use](#everyday-use)
5. [Human tasks and decisions](#human-tasks-and-decisions)
6. [Command reference](#command-reference)
7. [Where things live](#where-things-live)
8. [Troubleshooting](#troubleshooting)
9. [Safety, limits, and known gaps](#safety-limits-and-known-gaps)
10. [Upgrading safely](#upgrading-safely)
11. [Maintaining the harness](#maintaining-the-harness)

## How it works

```text
requirements file
      |  investigate        an AI reads the repo, asks you questions, drafts phases.json + issues.json
      v
   plan  ---- approve       you approve once; the plan is locked by a digest
      |
      v  import-issues      the drafted issues enter the harness as Ready
    run                     for each issue: implement -> checks -> review -> pull request -> merge -> post-merge checks
      |
      +--> status / issue / tasks    you watch, and answer questions when the harness needs you
```

Words used throughout:

| Word | Meaning |
|---|---|
| Plan | Phases, their allowed file paths, and the policy (budgets, merge rules). Locked by a digest when you approve. |
| Phase | A demonstrable step (P1, P2, ...) that may only change files on its path allowlist. Phases run in dependency order. |
| Issue | One small piece of work in a phase. Lives in the harness store, not on GitHub. |
| Attempt | One worker run on an issue (implementer, reviewer, refiner, or the delegating agent when a worker is stuck). Each has a lease that expires after 90 seconds without a heartbeat. |
| Evidence | Test and review results, each tied to the exact commit and base they were produced on. Stale evidence does not count. |
| Model choice | The delegating investigator picks a concrete model for each task's implementer, reviewer, and refiner, with a reason balancing cost and quality. |
| Model tier | An approved relative cost band: `low` (Haiku), `standard` (Sonnet), `strong` (Opus). These bands describe the model menu and bound repair escalation; they do not assign models to roles on newly investigated tasks. |
| Human task | A question the harness asks you: a decision, an asset, or a manual test. |
| Overseer | The top-tier agent that answers a stuck issue's *process* question before you are asked: retry, extend a budget, or refine. It never cancels, approves, merges, or changes policy; when it finds a harness defect or a content question, it escalates to you with its diagnosis. |

What an issue goes through: a **refiner** re-checks it if the code under it changed, and plans it once when its declared implementer tier is `standard` or `strong` (the plan and the tier the plan really needs are what the implementer gets), an **implementer** builds it in a throwaway copy of the repository, the harness runs the issue's own check commands, an **independent reviewer** (a different model) reviews the diff, the harness opens a pull request and merges it when every gate passes, and it reruns the checks on the merged `main`. Only then is the issue Done. A phase is Done when all its issues are Done and its exit checks pass.

**Every merge to `main` deploys to production.** This repository's deploy workflow runs on `main`, so each autonomous merge of a `sites/lesen` change goes live. Keep that in mind when you approve a plan.

### Model selection

During `investigate`, the planning agent receives the runtime-probed model menu
and the approved implementation budget. It chooses models per issue using task
complexity, uncertainty, risk, and available tests, then writes `model_choices`
with a `model` and `reason` for each worker role. Choices and reasons appear in
the investigation report and are recorded on dispatched attempts.

A straightforward, well-tested task can use an inexpensive model; a difficult
task can start with a more capable one without first paying for a failed cheap
attempt. An independent reviewer may be cheaper than its implementer when the
task warrants it. A different reviewer model is required whenever another
approved model is available. The runtime cannot prove model independence when
model routing is unavailable, and the harness reports that limitation.

The refiner is exempt from cost-first routing: by default it always runs on the
strongest approved tier. It re-reads a task and judges whether the code still
matches, and a cheap model there returns malformed results often enough that one
bad answer costs a repair attempt plus an owner decision. In a plan without
`model_routing` a `model_choices` entry naming a cheaper refiner is upgraded by
trusted code and the routing note says so; when no strong model is available the
harness keeps the best available one and reports the gap rather than blocking
the run.

A plan may instead *sign* one refiner in `model_routing` (see below). That
signature is the owner's own cost decision, so it replaces the strong default
for that role: the signed model is dispatched exactly as signed, at its own
approved band, with no upgrade and no substitution. A signed refiner must still
be `standard` or stronger — refinement stays a judgement role, so a `low`-tier
selection is refused at plan validation — and the overseer's strong floor is
untouched.

### Model sources

The tier menu is the union of the sources you choose. Pass `--model-source` to
`investigate` and `plan` (repeatable) and the plan records them, so you approve
the exact menu:

```
harness investigate --requirements req.md --model-source deepseek --model-source local
harness plan --requirements req.md --phases req.md_plan/phases.json      # keeps the draft's sources
harness plan --requirements req.md --phases req.md_plan/phases.json --model-source copilot  # overrides it
```

Sources are `copilot`, `deepseek`, and `local`. The default is `copilot`. Each
source contributes candidate ids per tier, and `harness models` probes them and
shows which ones this runtime accepts:

```
harness models --source local
```

**A standing source choice.** Set `HARNESS_MODEL_SOURCES` (comma separated, for
example `deepseek,copilot`) to decide which sources every new run is allowed to
use. `investigate`, `start`, and dashboard planning then stop asking and stop
defaulting to `copilot`; the dashboard's older `HARNESS_INVESTIGATOR_SOURCES` is
the fallback, and an explicit `--model-source` still wins. Both keys are read
from the git-ignored `sites/derschweigert/.env`, so the choice survives a new
terminal without exporting anything. Unknown names are dropped, and a source
without an accepted id still refuses to start rather than routing untested.

An id the runtime rejects is dropped from the menu. If a source has no accepted
id, `investigate` refuses to start and a plan built from it has no pickable
model, rather than silently routing to an untested one. If this
runtime names the models differently, replace any source/tier list in
`~/.local/state/derschweigert-harness/model_catalog.json`, for example
`{"local": {"strong": ["my-local-model"]}}`. The file is read when a plan is
built; it never changes an approved plan.

Selecting only `local` models also runs the investigator, implementer, and
reviewer on them. Keep two distinct models available per plan if you want an
independent reviewer.

Verified on GitHub Copilot CLI 1.0.103 in the worker image: only the four
`copilot` ids above are accepted by GitHub's own routing (`auto` also works but
is not a menu entry). A `deepseek` or `local` id is accepted only once that
source has a **provider profile** (below); without one the probe rejects it.

### BYOK provider profiles

The worker runtime is fixed, but it can be pointed at an OpenAI-compatible
endpoint with the `COPILOT_PROVIDER_*` variables it documents (`copilot help
providers`). The harness stores one profile per source and gives it to a worker
only for attempts that use that source:

```sh
# the key is read from an environment variable, never from the command line
DEEPSEEK_API_KEY=sk-... harness providers set deepseek --api-key-env DEEPSEEK_API_KEY
harness providers show      # the key is redacted
harness providers rm deepseek
harness models --source deepseek --refresh   # proves the endpoint and key work
```

* Profiles live in `<store>/providers.json`, mode `0600`, and follow the same
  rule as `copilot.token`: the value travels in the docker client's
  environment and is forwarded by *name* into the sandbox.
* A BYOK attempt needs no GitHub token; a `copilot` attempt needs no profile.
  A plan that mixes both forwards both.
* The wire model is the part of the id after the source prefix, so
  `deepseek/deepseek-flash` is sent to the provider as `deepseek-flash`.
* `providers set` defaults to the source's known endpoint
  (`https://api.deepseek.com` for `deepseek`); pass `--base-url` to override,
  for example `https://api.deepseek.com/v1` or a local Ollama
  (`http://127.0.0.1:11434/v1`).
* A probe treats a non-zero exit as "not accepted", so a wrong key or an
  unreachable endpoint shows up as a rejected id rather than a silent pass.

The dashboard's **Models** view lists the same catalog per source and tier and
probes on demand. A probe runs in the background, one at a time, at most once a
minute, and never in `--read-only` mode; the page shows when each id was last
checked and whether this runtime accepts it.

Trusted code rejects unknown or unavailable choices, empty reasons, and choices
that exceed the strong implementation-attempt budget. Failed checks or review
findings retain the existing bounded repair escalation; an initial reviewer
choice that now matches the implementer's current model, after a repair or after
a delegator retry, is rerouted independently.
Infrastructure failures alone do not justify an upgrade. No extra routing-agent
call is added per worker.

Cost bands are policy estimates, not live prices. Token usage and actual cost
remain unavailable. Existing imported issues without `model_choices` keep the
legacy role mapping; existing issues and running coordinators are not rewritten.
The `investigate --tier` option selects the planning agent only. Changing the
approved model menu or budgets still requires renewed plan approval.

An optional `model_routing` object in `phases.json` pins the refiner and separates
routine models from escalation models. For example:

```json
{
  "routine_models": ["deepseek/deepseek-flash", "deepseek/deepseek-v4-pro"],
  "refiner": "claude-opus-5",
  "escalation_models": ["claude-haiku-4.5", "claude-sonnet-5", "claude-opus-5"]
}
```

These are subsets of the approved `model_tiers`, not extra authorization.
Every fresh issue is refined first. Routine implementation and independent
review stay inside `routine_models`; quality repairs and delegator, analyst,
and overseer consultations use `escalation_models`. The refiner remains pinned
in both cases, and it is dispatched at the band the signed model is approved at
(`claude-sonnet-5` runs as `standard`, `claude-opus-5` as `strong`) without a
tier upgrade. The signature also wins over a per-issue `model_choices.refiner`
written under an earlier plan version: switching the refiner is a new plan
version, and recorded issues and their history are not rewritten for it.
Missing models fail closed, never falling back to another source
or the runtime default. Plans without this object keep their existing behavior.
Changing it requires a new plan version and personal approval. Reimporting an
unchanged completed issue preserves its historical evidence; completed work
cannot be redefined. Pending required CI checks can wait up to 30 minutes,
independently of scheduler polling frequency, without spending repair budget.

For Buchstabenzeit run branches, `.github/workflows/lesen-native.yml` builds an
Android debug APK and an unsigned iOS simulator app from the PR revision.
Until the iOS phase adds its actual project, CI generates a temporary Capacitor
shell from the locked packages. The aggregate `lesen-native` check fails closed
for absent, failed, cancelled or skipped required builds. A run-branch ruleset
must require that check; merely adding the workflow does not enforce it.
Neither build proves physical-device behavior, signing, or publication.

### When a worker is stuck

An implementer that cannot complete its task sets its outcome to `blocked` and
lists what it tried in `blockers`. A `done` outcome that still lists blockers
counts the same way, and an unrecognized outcome fails as an invalid result.
The harness never publishes, checks, or merges a stuck attempt. The report is a
request for direction, not evidence.

The issue then goes to the delegating agent (role `delegator`, read-only, on the
`standard` tier) instead of repeating the attempt, at most
`delegator_consults_per_issue` times per issue (default 1). It reads the stuck
report, the attempt history, and the model menu, and returns one decision:

* `retry`, with optional guidance for the next attempt and an optional model choice with a reason. Trusted code applies the planning checks (approved, available, reason present, strong budget), and the choice carries over to later retries.
* `ask_owner`, with a diagnosis of what you must decide, for example how to split the task. The issue goes to the strong analysis below when one is available, and then blocks with a decision task that shows the diagnosis.

An unusable decision, or a consultation that fails for a reason other than a
transient one, becomes a decision task for you. Neither a stuck report nor a
consultation spends repair budget, and a second stuck report on the same issue
goes to the strong analysis below and then to you, not back to the delegating
agent. Plans approved before this change carry no consultation budget, so their
stuck reports skip the consultation until you approve a new plan version. Failed checks and review findings keep the repair budget and tier
escalation and do not trigger a consultation. Each consultation is one extra AI
call.

#### Strong analysis and split proposals

Before a stuck issue reaches you, a strong-tier model (role `analyst`, read-only,
up to `analyses_per_issue` times per issue, default 1) studies the repository and
the history. It runs after the delegating agent chooses `ask_owner`, or after a
second stuck report. It reports a root cause and one recommendation: `split`,
`retry` with guidance, or `needs_owner` with the decisions you must make.

For a split, the model proposes 2 to 6 issues. Trusted code checks that every
requirement of the original is covered, ids are new, anchors stay inside the
phase path allowlist or exist, commands pass the deny list, dependencies are
other parts or the original's, and there are no cycles or credentials. A valid
proposal is saved in the private store under `analyses/` in the format
`import-issues` reads, and the decision task and `harness issue` show it. An
unusable analysis is discarded and you receive the delegating agent's diagnosis
instead.

The analysis is advice until you act on it. Nothing is imported or restarted on its
own, and you still choose an option on the decision task. When it proposes a split,
the task gains a sixth option, `apply the proposed split`. Choosing it makes the
harness check the proposal again against the current state (ids still new, anchors
valid, models still available), then create the parts, point the issues that
depended on the original at all of the parts, and cancel the original. If the check
fails now, you get a new decision task that says why. A part written before an
interruption is advanced to `Ready` on the next pass and never moved backwards,
so a resumed apply neither duplicates a part nor leaves one unworked. Parts carry
the models the analyst chose for them, and the original's own models are not copied. The analysis
costs one strong-model call and does not use the strong implementation-attempt
budget. It is skipped when the budget is zero, the runtime offers no approved
strong model, or model routing is unavailable.

## One-time setup

You need:

| Need | Check | Expected |
|---|---|---|
| Python 3.9+ and git | `python3 --version`, `git --version` | installed |
| Docker, running | `docker info` | prints a server version |
| `gh` signed in as the repository owner | `gh auth status` | logged in, scopes include `repo` and `read:project` |
| Worker image | `docker images harness-worker` | `harness-worker:1` is listed |
| Engine toolchain in the image | `docker run --rm harness-worker:1 sh -c 'godot --headless --version; gdlint --version'` | `4.7.2.stable.official...` and gdtoolkit `4.5.0` |
| Token files | `ls -l ~/.local/state/derschweigert-harness/` | `broker.token` and `copilot.token`, both `-rw-------` |

* `broker.token`: a GitHub token the harness uses to open and merge pull requests. Keep it in the store folder only, never in the repository.
* `copilot.token`: a fine-grained token with only the **Copilot Requests** account permission and no repository access. Workers receive only this one. It expires, so renew it before the date it was issued for.
* Optional: Blender (`blender` on your PATH) for procedural assets.
* Godot is not installed on your machine: the pinned Godot 4 editor, gdtoolkit (`gdlint`, `gdformat`), and the GUT test
  runner live in the worker image. Changing any of them means rebuilding the image and rerunning `isolation verify`.
  Export templates and the Android SDK are deliberately absent; Android builds stay a human-owned release workflow.

Set up a shortcut in every terminal you use (it only lasts for that window):

```sh
cd /Users/ursschweigert/Documents/GitHub/DerSchweigert
alias harness='PYTHONPATH=tools python3 -m harness'
```

Build and verify the worker sandbox. Verification expires after 24 hours, so repeat it daily:

```sh
harness isolation build     # once, or after changing tools/harness/worker/Dockerfile
harness isolation verify    # daily; prints {"tier": "A", ...}
harness status              # first lines should say: Tier A ... run permitted
```

If `status` says Tier B, the sandbox is not verified and `run`, `investigate`, and real GitHub writes refuse to work.

Real merges also require classic GitHub branch protection on the base: strict
up-to-date status checks, at least one required check, and enforcement for
administrators. The broker identity must be able to read those settings.
Missing, unreadable, or weaker protection blocks the merge. Ruleset-only or
merge-queue configurations are not independently verified by this implementation
and do not substitute for this precondition. The harness never changes GitHub
protection settings itself.

A required check that has not reported is *missing*, not failing. GitHub refuses
the merge with 405 in both cases, so the harness separates them by wording: a
check that is "in progress", "queued" or "expected" simply has not answered yet,
and the merge waits (up to 30 minutes, no repair budget, no new attempt) until it
does. Any other refusal is a real failure and costs an attempt. A check that is
*expected* usually belongs to a job that has not started, such as a gate that
aggregates other jobs with `needs:`; its check run does not exist until they
finish.

For the same reason, verifying work that was merged outside the harness
(`reconcile-completion`) reads the checks on the merge commit first. A gate that
only triggers on `pull_request` never runs on that commit, so when a required
check is absent there the harness falls back to the checks on the tested head,
and only if the merge commit and the head have the identical Git tree id, which
proves the merged content is byte for byte what was tested. A check that *failed*
on the merge commit is never overruled by the head, and a differing tree reads
nothing: both fail closed.

*Absent* here means the merge commit never reported that context at all. A check
that is queued or running on the merge commit has reported, so it counts as
pending and is never satisfied from the head: completion waits for the merged
revision's own answer. Where a context reports more than once, the newest report
decides, so a rerun that is queued again is not masked by the success it
replaces; and where a check run and a commit status share a name, the one that is
not successful decides.

## Quick start

The shortest path is one command. It checks the environment, asks for the requirements file and the model sources,
investigates, plans, approves (you still type the digest), imports the issues, and then offers to run — skipping every
step the store already shows as done, so rerunning it resumes where you stopped.

```sh
harness start
# or, without prompts for the file and the sources:
harness start --requirements uploads/20261026_improvements.md --model-source copilot
```

Use the individual commands below when you want to do one step at a time.

Replace the file name with your requirements file.

```sh
# 1. Let the investigator draft the plan. It asks you questions in the terminal when it is blocked.
harness investigate --requirements uploads/20261026_improvements.md
#    writes uploads/20261026_improvements.md_plan/{phases.json, issues.json, investigation-report.md}
#    Read the report. If something is wrong, revise with feedback:
harness investigate --requirements uploads/20261026_improvements.md --feedback "Umlauts stay in Vowels."

# 2. Save the plan (this writes nothing to GitHub). Add --dry-run first to only validate it.
harness plan --requirements uploads/20261026_improvements.md --phases uploads/20261026_improvements.md_plan/phases.json

# 3. Approve it once. Needs a real terminal. Read the printed phases and policy, then type the first 12 characters of the digest.
harness approve 20261026-improvements-md

# 4. Load the drafted issues.
harness import-issues 20261026-improvements-md uploads/20261026_improvements.md_plan/issues.json

# 5. Run. It stays in the foreground; leave that terminal open.
harness run 20261026-improvements-md

# 6. In another terminal: watch, and answer questions.
harness status
harness tasks
```

The plan ID is the requirements file name in lowercase with punctuation turned into dashes. `plan` prints it.

Issue guidance and retained delegator guidance reach the refiner, implementer
and independent reviewer in `untrusted_data`. Reviewer packets retain those
handoffs alongside the diff and checks, so operational acceptance details do
not disappear between roles. Guidance cannot override approved scope,
protected paths, budgets or required evidence; a green build is not proof of
functional coverage.

Optional extras: `harness sync PLAN_ID` creates a requirements issue, milestones, and phase issues on GitHub for visibility (try `--dry-run` first). It does not create the individual work issues. `run` never creates GitHub issues.

## Everyday use

**Watch progress**

```sh
harness gui                       # local monitoring and management, opens the browser
harness status                    # plan, phases, queue, workers, blockers, tasks, budgets
harness status --plan bugfixes-001-md   # only that plan's phases, issues and workers
harness status --json             # the same, machine-readable
harness issue p1-stars-animation  # everything about one issue: scope, attempts, evidence, history (add --json)
```

Reading `status`: `Ready` waits to start, `In Progress` has a worker, `In Review` has a pull request awaiting review or merge, `Blocked` needs a dependency or a human task, `Done` is merged and checked on `main`, and `Cancelled` was dropped by you or replaced by a split. The `worker` lines show who is running and for how long. Token and cost figures are estimates and are labeled by source, see [Token and cost estimates](#token-and-cost-estimates).

**Local dashboard**

Without the alias, run `PYTHONPATH=tools python3 -m harness gui` from the
repository root. The default address is `http://127.0.0.1:8765`; use `--port 0`
for a free port and `--no-browser` to print the address without opening it.
Choose a different port if 8765 is already occupied.

```sh
harness --home /path/to/state gui --read-only --port 0 --no-browser
```

Monitor shows the selected plan's latest version, phases, coverage, budgets,
workers, check jobs, leases, and blockers. Issues supports search, filters, and
revision-bound evidence inspection. Tasks accepts decisions, manual-test
results, and asset uploads. Activity shows events and output from runners
started by this dashboard instance. Live refresh defaults to five seconds;
`--refresh` accepts 3-60 seconds.

**Daily sandbox verification**

Click **Verify isolation** under Isolation in the sidebar to run the daily
`harness isolation verify` check. Progress, probe results, and errors appear
under **Daily sandbox verification** in Planning. This works even when the
attestation has expired or is missing (Tier B). Success renews the signed
24-hour attestation through the existing verifier; it does not bypass any
probe. Docker must be running and the worker image must already be built.
The button does not build images, change credentials, or start a live run.

**Create and approve work in Planning**

1. Open **Planning**, then upload a Markdown file or paste its text. Plain
   paragraphs and list items work; no requirements table is needed.
2. Click **Extract requirements**. Review, edit, add, split, or remove entries
   before **Save as new workspace** (a fresh workspace) or **Update this
   workspace** (correct the selected one in place). Plain text receives stable
   IDs (`R1`, `R2`, ...); existing formatted requirement tables keep their IDs.
   The original Markdown is retained as context, and the edited table is
   authoritative. Correcting a requirement changes the plan, so the next
   **Prepare plan and checks** makes a new version with a new digest that you
   approve again; a workspace is only locked while its plan runs.
   Markdown is limited to 1 MiB, with 1-200 requirements of at most 2,000
   characters each.
3. Click **Start investigation**. Its progress appears under Preparation
   output. Answer any investigator questions in the view and continue.
   Review its report and issue definitions. To change the draft, enter
   feedback and choose **Revise draft with feedback**.
4. Click **Prepare plan and checks**. This saves the proposed version and
   preflights both phase and issue-specific checks in the existing sandbox.
   Review the exact plan, scope, policy, issues, and preflight results. A
   check that names a file no worker may create, or that ends in `|| true`
   and can therefore never fail, is refused here; a failed preparation shows
   in the banner at the top of the dashboard and in the Preparation output.
5. Type the first 12 digest characters and click **Approve reviewed plan**.
   Approval uses the server-verified local identity and the same signed
   scope-and-policy record as terminal approval. Changed versions, revised
   drafts, unresolved questions, or validation configuration errors block
   approval. Approved workspaces cannot be revised; create a new workspace.
   Dashboard approval authenticates this browser session, not a distinct
   person: it is the owner's own-machine path. Use `harness approve` in a
   terminal when an approval must not be delegable.
6. Click **Import approved issues**. Once it succeeds, select the new plan
   in the sidebar and use **Start run** when ready. Approval and import do
   not start workers or perform merges.

Investigation, preparation, approval, and import require current Tier A
verification. Preparation jobs run asynchronously; their status, drafts,
questions, and output persist in the store's `gui-workspaces/` directory and
can be revisited after reopening the dashboard. Verification output lives in
`gui-maintenance/`. Workspaces have a short unique suffix in their plan IDs
to prevent accidental reuse. Only one GUI preparation or verification job
runs at a time. Do not start multiple dashboards against the same store;
there is no cross-dashboard singleton lock. If a preparation process dies,
its failure is shown with its output and can be retried. Image builds and
dry-run rehearsal remain terminal commands.

**Clear completed issues**

In **Issues**, select individual Done issues (or all visible Done issues)
and click **Archive selected Done**. This hides them from the default list
and sidebar count, across refreshes and dashboard restarts. Completion totals,
requirements coverage, dependencies, evidence, and history are unchanged;
nothing is deleted from the harness or GitHub. Enable **Show archived**,
select entries, and click **Restore selected** to bring them back. Non-Done
issues cannot be archived.

Start, Resume, and Recover launch the trusted coordinator, not a worker command
from the browser. A valid existing signed approval and current Tier A
attestation are required. Launch and cancellation require the exact plan ID;
the server rejects a changed plan version.
Starting an approved run can merge to `main` and deploy production.

Closing the browser or dashboard does not stop a launched coordinator. Use
Pause or Cancel and wait for the coordinator to acknowledge the request. A
reopened dashboard still reads persisted state, but managed process details
and log tails belong to the instance that launched them. Healthy external
runner heartbeats block duplicate launch; do not start several dashboard
instances against one store as a cross-process locking mechanism.

The dashboard binds only to IPv4 loopback. Do not expose it through a proxy,
tunnel, port forwarding, or shared remote desktop. It trusts the local OS
account; browser request protections are not multi-user authentication. Use
`--read-only` to disable mutation routes. Reading an uninitialized store does
not create it. Asset uploads are limited to 10 MiB and still pass the existing
asset policy, path, format, provenance, and checksum validation.

**A status page on GitHub (no tunnel, no dashboard)**

`harness report <plan-id>` renders the run's current state as one markdown page and, when given a repository, publishes it
to a branch of its own: `harness/status/<plan-id>`. GitHub renders that file in the repository view, so the state is
readable from anywhere without a tunnel, a Pages setup, or a workflow — the status branch matches no push trigger in
`.github/workflows`.

```
harness report 20261028-arithmoslayer-md --once          # one page, then exit
harness report 20261028-arithmoslayer-md --interval 300  # keep it current
harness report 20261028-arithmoslayer-md --no-push       # keep it local only
```

The page shows the plan and its digest, the phase table, what is running now with model and elapsed time, what is
waiting for you, the last events, and the pull requests opened. It is regenerated only when something changed, and the
branch always holds exactly one commit, replaced under a lease against the branch tip it read.

The publisher reads the store read-only and writes one file to one branch. It never touches the run branch, the base
branch, evidence, or a lease, so it can run beside a live coordinator — a second terminal, or a detached process — without
changing what that coordinator decides. A failure (no network, no token) is printed and the next interval tries again; it
can never fail a run. A copy is always kept at `<store>/status-<plan-id>.md`. The page is redacted: no home directory, no
token.

**Remote dashboard (operator override)**

`harness remote` is an explicit, opt-in exception for when you need the dashboard
while away from the machine. It does not re-bind the dashboard: it runs a second
loopback-only service that sits in front of the GUI, adds the PIN gate the
dashboard deliberately lacks, and forwards a fixed allowlist of routes while
rewriting the loopback `Host`/`Origin` metadata the GUI requires.

Configuration lives in the git-ignored `sites/derschweigert/.env` (only
`HARNESS_*` keys are read, never the app's other secrets):

```sh
HARNESS_GUI_PIN=...                     # required
HARNESS_TUNNEL_PROVIDER=localhostrun    # cloudflared | localhostrun | ngrok (default cloudflared)
# HARNESS_TUNNEL_NAME=harness           # cloudflared named tunnel only
# HARNESS_TUNNEL_HOST=...               # cloudflared named tunnel only
# HARNESS_NO_TUNNEL=1                   # opt out of auto-start
```

When `HARNESS_GUI_PIN` is set, `harness gui`, `harness run`, and `harness resume`
automatically start the relay and the configured tunnel provider and print the
address. Pass `--no-tunnel` to start without the tunnel.

- `localhostrun` needs no account or install: it uses `ssh` and prints a new
  `https://...lhr.life` URL each launch.
- `ngrok` prints a new `https://...ngrok-free.app` URL each launch and needs a
  free authtoken.
- `cloudflared` uses a quick tunnel by default (new `https://...trycloudflare.com`
  URL each launch), or a named tunnel when both `HARNESS_TUNNEL_NAME` and
  `HARNESS_TUNNEL_HOST` are set (stable address, needs a Cloudflare zone).

A `cloudflared` named tunnel needs one-time setup on this machine:

```sh
cloudflared tunnel login                 # opens a browser to authenticate
cloudflared tunnel create harness
cloudflared tunnel route dns harness harness.derschweigert.de   # or a CNAME at your DNS provider
```

Sessions are signed cookies (HttpOnly, SameSite=Strict, Secure behind the
tunnel) that expire after 12 hours by default (`--session-hours`). Five wrong
PINs lock the address out for 15 minutes. The relay only proxies the GUI's
known GET/POST routes to the fixed `--upstream` URL, enforces the 16 MiB body
cap, and never logs bodies, tokens, or the PIN.

This weakens the default posture: anyone with the PIN and tunnel URL can reach
the dashboard, and dashboard approval can merge to production. Prefer the
strongest tunnel access layer you have (for example Cloudflare Access in
addition to the PIN), keep the machine's store folder private, and stop the
relay when you are back. The dashboard itself remains loopback-only and is
never exposed directly.

**Pause, resume, stop**

```sh
harness pause PLAN_ID           # finish the workers in flight, start nothing new, then stop
harness pause PLAN_ID --now     # cancel the workers in flight instead of waiting
harness pause PLAN_ID --after-phase P2   # let P2 land whole, start nothing outside it, then stop
harness resume PLAN_ID          # continue a paused or interrupted run
harness cancel PLAN_ID          # permanent: the plan cannot be resumed. --drain lets active workers finish first
```

`--after-phase` names a gate. Until that phase is Done, the only phases that may
start anything are the gate itself and the phases it waits for, directly or
indirectly. Phases that merely became eligible at the same time, such as a
sibling branch of the same predecessor, do not start: they would otherwise run
beside the gate and the pause would arrive with work already spent past it.
Phases that were already Done stay Done, and work that was already running when
the gate was armed keeps its progress but is not merged while the gate holds; it
continues on `resume`. You may name a phase the run has not reached yet, but not
one the plan does not contain.

The gate is one-shot: the pause it causes clears it, so a plain `resume`
continues the whole plan. To go one phase at a time, arm the next gate before
resuming — `pause PLAN_ID --after-phase P3` works on a paused plan and only
records the gate: no plan or phase changes state and no worker starts. A gate on
a phase that is already Done is refused rather than quietly letting the rest of
the plan run, and so is a gate on a plan that is neither running nor paused.
Pausing without `--after-phase` still requires a running plan. If a stored gate
cannot be resolved against the approved plan, the run pauses and says so instead
of continuing without it.

Ctrl+C in the `run` terminal also stops the loop. It is safe: leases expire, workers are fenced, nothing is marked done by absence, and `resume` carries on. Afterwards check `docker ps | grep harness` and remove leftovers with `docker rm -f NAME`.

Checks before review, after rebasing, after merging, and at phase validation are
polled jobs. Long commands do not hold up scheduler heartbeats. Graceful pause
and cancellation with `--drain` wait for active checks; immediate stops cancel
their named containers and remove their work directories. Each check command
has a 900-second default deadline, also enforced inside the container if the
runner exits. On resume, expired saved check jobs are cleaned up and rerun;
their missing results never count as a pass.

Restart the run after you change harness code, because a running process keeps its old code in memory.

**Rehearse without side effects.** `run --dry-run` uses real workers, checks, and reviews but only records pull requests and merges. It works on a throwaway copy of your state (the path is printed; watch it with `harness --home THAT_PATH status`), so your real plan is untouched. It costs the same AI usage as a real run, so use it only if you want a safety net.

### Token and cost estimates

The runtime reports no token or cost data, so the harness records estimates and labels each one by where it came from:

* An agent estimate: every worker, including the investigator, adds a rough `usage_estimate` of the tokens it read and wrote. It is the agent's own unverified account, and a malformed one is ignored.
* Size only: the harness counts the prompt and task file it sent and the result it got back. This is a lower bound, because it cannot see the files the agent read.
* Runtime lines: output lines that mention tokens, usage, or premium requests are kept as text with the attempt (see `harness issue ID --json`). The format is unverified and a worker writes to the same stream, so they are stored but not parsed.

An attempt's figure is its agent estimate when it gave one, otherwise the size-only lower bound. Failed attempts count too. `harness status` shows totals for the plan and for each model, `harness issue` shows each attempt, and the dashboard footer and attempts table show the same. The figures never limit anything: budgets still use attempts, wall-clock time, and pull requests.

The harness cannot know your prices, so cost stays unavailable until you add `model-prices.json` to the store folder:

```json
{"unit": "USD", "models": {"claude-haiku-4.5": {"per_million_input": 1.0, "per_million_output": 5.0}, "claude-sonnet-5": {"per_attempt": 1}}}
```

Each model takes `per_million_input`, `per_million_output`, and `per_attempt` (for request-based billing). Use your own numbers and unit. Models without a price are listed as unpriced and left out of the total, and an invalid file is reported and ignored.

## Human tasks and decisions

The harness asks you things through tasks. `harness tasks` lists the open ones with everything you need, and `harness status` shows how many are waiting. Silence never counts as an answer: reminders go out after 24 hours (at most 3), and after 72 hours the secondary owner is notified.

Before you answer, the [human-task-triage agent](../../.github/agents/human-task-triage.agent.md) can take the task over. It reads the open tasks, decides whether the cause is a harness fault it can reproduce, fixes and tests it, re-drives the blocked work, and hands you only the questions that need your intent: scope, budget, credentials, licenses, and manual device or visual checks. It may answer or acknowledge a task for you only when you approve it in that conversation; the trusted local command resolves the OS account and the `gh` login, so it cannot tell the agent apart from you. That limit is an instruction to the agent, not runtime enforcement.

A worker's own question (`needs_input` from the refiner) is triaged by the harness itself before you see a decision task: the `analyst` role runs first, whatever `analyses_per_issue`, `strong_attempts_per_issue`, the repair budget, or the transient budget say. You then get the root cause and its questions instead of a raw failure. Budget and policy failures are not triaged; trusted code decides those. Without an available strong model the launch is refused and you are asked directly, as before.

**Which model plans.** The GUI has no model picker, so the planning steps read their model from the
same git-ignored env file (only `HARNESS_*` keys):

```sh
HARNESS_INVESTIGATOR_SOURCES=deepseek     # comma separated; empty keeps the policy default
HARNESS_INVESTIGATOR_TIER=strong          # low | standard | strong; empty keeps the default
```

The investigator writes the chosen sources into the draft, so the `plan` step and everything after it
inherit them. Without these keys the investigator runs on the policy default (copilot, tier standard).

**Intent.** `harness plan --intent "..."` records one paragraph on why the plan exists. It is inside the
approval digest and every task packet carries it, together with the titles of the requirements the issue
serves and the phase's outcomes, non-goals and exit criteria. A worker that reads only acceptance criteria
can be correct and still miss the point.

**Escalation boundaries.** Every worker packet also carries the approved
`escalation_paths`, which override the phase allowlist, code anchors and earlier
plans. The prompt tells refiners and implementers not to plan or edit these
owner-merged files. If the acceptance criteria can be met without touching them,
the worker must do so; otherwise it reports the concrete owner prerequisite.
Trusted diff enforcement remains unchanged.

A refiner lists the files its plan writes in `plan_files` (paths, not prose).
This is required whenever it reports `ready`; `[]` is a valid answer and means
the plan writes nothing. Whether a refinement owes that declaration is decided
by the contract recorded in its attempt at dispatch (`result_contract`,
currently `plan_files/1`), never by what the worker sends back, so an attempt
recorded before the contract existed -- history, or a worker in flight across
the upgrade -- is still read under the old rules. A `ready` result that omits
the declaration under the contract is rejected like any other malformed result:
the attempt fails `schema_invalid`, the reason reaches the next refiner attempt
as `your_previous_answer_was_rejected`, and no implementer is dispatched on a
plan whose file list trusted code could not read.

When a declared file is owner-merged, the plan is held at the refinement
boundary: the issue blocks with the prerequisite and the files named, the plan
is kept so you can read what was asked for, and no implementer is dispatched to
carry out work the diff gate would reject. That hold is not a failure -- the
refinement stays a success and no repair or transient budget is spent. Every
declared path is inspected; an over-long list or an empty entry is an error,
never a shortened list, because the entry a silent bound dropped could be the
owner-merged one. Only the declaration is read, so a plan that names a
protected file in prose -- to say it must not be edited, or that its change is
already merged -- is not held, and the diff gate remains the enforcing boundary
either way. When a previous refinement crossed
this boundary, use the decision task's re-refinement option with guidance rather
than retrying the stale plan. Replanning packets retain that owner guidance
alongside changed-anchor and missing-file context. Any optional owner wiring that depends on a new
worker file must land after that file, not before it.

**Descoping.** A plan that cannot finish delivers nothing, so a requirement may be deferred to a named
follow-up issue: `harness defer PLAN REQ --reason "..." --followup ISSUE_ID`, and `harness defer PLAN --list`
shows what was deferred. The plan policy decides how far that may go (`policy.descope`), and that policy is
inside the approval digest. A deferred requirement no longer blocks its phase, so the plan can complete.
Afterwards `harness restore PLAN` writes `<plan>-restore-1` with one issue per deferred requirement, chained
so the scope returns one increment at a time; you approve that plan like any other.

**Decision tasks** are raised by the harness itself when an issue is blocked (budget used up, a policy failure, or a refiner that needs your input). It is not a request from a reviewer or a worker. Each task shows the reason, the recent failures, and these options:

| # | Option | What happens |
|---|---|---|
| 1 | retry as is | The next step runs again with no changes. Use it when the cause looks like a fluke or a harness fault. |
| 2 | give guidance and retry | Same, and your hint goes to the worker. |
| 3 | refine the scope | The issue goes back to be re-planned. Use it when the issue itself is unclear or too big. |
| 4 | cancel the issue | The issue is dropped, and so is every issue that depends on it, because they can no longer run. They show as `Cancelled`. |
| 5 | extend retry budget and retry | One more attempt in the exhausted retry class, recorded as an override. |
| 6 | apply the proposed split | Offered only when the strong analysis proposed a split. Replaces the issue with the proposed ones. |

A phase whose issues are all finished or cancelled, but whose requirements are not all covered by a finished issue, cannot complete. The plan pauses and says which requirements are uncovered. Import issues that cover them with `import-issues`, then `resume`.

```sh
harness respond TASK_ID --option 1
harness respond TASK_ID --option 2 --guidance "Use the helper in sites/lesen/static/storage.mjs"
```

An issue that already has a pull request and passing checks resumes at review instead of being implemented again. One that is already merged only has its post-merge check redone.

**Asset tasks** ask for a file when no automated source produced a valid one:
`harness respond TASK_ID --answer source=self-made --answer license=CC0-1.0 --answer author=Me --artifact ./crate.glb`.
The file is validated (format, size, polygons, license, no embedded scripts) before it is accepted.

Asset classes and their per-file ceilings. Every limit is checked with standard-library parsers; a file that cannot be
read is refused rather than assumed good. The ceilings are sized so that a release bundle stays inside the 150 MB budget:

| Class | Formats | Ceilings | Typical size |
|---|---|---|---|
| `sprite` | png | 1 MB, 1024 px | 10-100 kB |
| `texture` | png, jpg | 4 MB, 2048 px | 100-800 kB |
| `hdri` | hdr, exr | 20 MB, 4096 px | 5-15 MB |
| `model3d` | glb, gltf | 5 MB, 100 000 triangles, 20 m | 20-500 kB |
| `audio_sfx` | wav, ogg | 500 kB, 3 s, 48 kHz, 2 channels | 10-50 kB (Ogg) |
| `audio_music` | ogg | 3.5 MB, 180 s, 48 kHz, 2 channels | about 2 MB per 3-minute track |
| `font` | ttf, otf | 1.5 MB | 100-400 kB |

* Licences: the global allowlist is CC0-1.0. A class may replace it; `font` allows `OFL-1.1` and `Apache-2.0`, and every
  other class keeps CC0-1.0. A font must ship its licence text next to the file; the harness copies it to
  `<font>.LICENSE.txt` and records it with its checksum in the manifest.
* Audio and fonts have no automated source in the policy, so a request for one goes straight to an asset task. Audio can
  come from a committed synthesis script (procedural) or from you; fonts come from you together with the licence text.
* WAV is measured with `wave`, Ogg Vorbis with a page and granule reader, and fonts with an sfnt magic and table check.
  Chained or multiplexed Ogg streams, fonts whose tables point outside the file, and files without a readable length all
  fail closed.
* The asset directory is per plan: `harness plan ... --assets-dir apps/arithmoslayer/assets/` (the investigator may also
  put `{"assets": {"output_dir": "..."}}` in `phases.json`). The directory must be repository-relative, end with `/`,
  and cannot contain `..`; traversal and symlinks stay refused. The choice is part of the policy, so it is bound by the
  approval digest.

**Manual test tasks** ask you to try something by hand on an exact commit:
`harness respond TASK_ID --outcome pass --tester me --revision COMMIT --evidence screenshot.png`.
A result for an older commit is rejected as stale, and `inconclusive` stays open. A manual pass never replaces the automated checks.

To see tasks on GitHub as well, run `harness sync-tasks PLAN_ID` (mirrors open tasks as issues and mentions you).

## Browser smoke check

Unit tests cannot catch wiring between scripts, so changes under `sites/lesen/static/` also get a real-browser check. A headless Chromium in the worker image opens the page, checks that the letter groups render, the word counter reacts, a full practice session runs, statistics are saved, and the landscape layout fits. Any console error or failed request fails it.

* Rules live in `tools/harness/smoke.json` (changed paths → command). The scripts are baked into the image (`worker/smoke/`), so workers cannot edit or skip them.
* The check runs with the issue's own commands: before review, after a rebase, after the merge, and at phase validation. A failure goes back to the worker with the end of the output.
* After rebuilding the image (`isolation build`) run `isolation verify`. The probe now also checks that the browser is present.
* To try it by hand: `docker run --rm --user 10001 -v <repo-dir>:/w:ro -w /w harness-worker:1 node /opt/harness/smoke/lesen.mjs .` (the directory must be inside a Docker-shared path, such as your home folder).

## Godot project checks

Changes under `apps/arithmoslayer/` get a headless Godot check as well. The script copies the project to a throwaway
folder, imports it with `godot --headless`, and loads every script, scene, and resource, instantiating each scene.
A parse error, a scene that cannot load, or a script that does not compile fails the check.

* Rule: `tools/harness/smoke.json` maps `apps/arithmoslayer/` to `sh /opt/harness/smoke/godot_project.sh /work apps/arithmoslayer`.
  The script and the GDScript it runs (`worker/smoke/godot_verify.gd`) are baked into the image; workers cannot edit them.
* The pinned GUT runner is copied into that throwaway project, so `extends GutTest` test scripts compile without the
  repository vendoring GUT. GUT's own internals are skipped: they are trusted image content, not project code.
* Headless Godot does not render. The check proves scripts and scenes load; it says nothing about how the game looks,
  about shaders and particles, or about frame time. Those stay `visual_judgment` and `physical_device` human tasks.
* Tests inside a phase run through `godot-test <project dir>`, which is on the worker's `PATH`. It copies the project to
  tmpfs, adds the image's GUT, imports, and runs `-gdir=res://test`. Extra GUT flags may be appended, for example
  `godot-test apps/arithmoslayer -gdir=res://tests`. GUT prints a "new version available" notice that only reflects the
  bundled version list; it is not a network call and the pinned GUT never upgrades itself.
* Lint and format with `gdlint <paths>` and `gdformat --check <paths>`. All of `godot`, `godot-test`, `gdlint`, and
  `gdformat` pass the validation-command filter; `docker`, `npx`, `curl`, `gh`, and `git push` still do not.
* To try it by hand: `docker run --rm --user 10001 -v <repo-dir>:/w -w /w harness-worker:1 sh /opt/harness/smoke/godot_project.sh /w apps/arithmoslayer`
  (the directory must be inside a Docker-shared path, such as your home folder).

The check runs on a copy, so `/tmp` in the container bounds its size: a project plus its import cache must fit in the
256 MB tmpfs. That is plenty for a small project and will need attention once the audio and art land.

## iOS shell checks

Once `sites/lesen/ios/` exists, changes to the iOS shell, to `capacitor.config.json`, to the web source in
`static/`, or to the copy step in `scripts/` also get a trusted offline check. It reads the app the way a reviewer
would and never builds or signs anything: the macOS release workflow remains the only build authority.

* Rule: `tools/harness/smoke.json` maps those paths to `sh /opt/harness/smoke/ios_shell.sh /work sites/lesen`.
  The script is baked into the image (Python standard library only, no network), so workers cannot edit or skip it.
* It fails when `capacitor.config.json` has no reverse-DNS `appId` or `webDir`, when it sets `server.url` or
  `server.cleartext`, when it allows navigation to an unreviewed host, when `Info.plist` or `PrivacyInfo.xcprivacy`
  is missing or does not parse, when `Info.plist` does not declare exactly `de` and `en` in `CFBundleLocalizations`
  or opens App Transport Security, when the privacy manifest declares tracking or lacks a reason code per
  required-reason API under `NSPrivacyAccessedAPITypeReasons`, when the Xcode project does not bundle the privacy
  manifest and the web assets, or when a bundle loads anything over the network, references a file that is not
  there, or is missing one of the 28 required runtime files.
* Every bundle present is checked, not the first one found: the source `static/`, the copied `www/`, and the
  generated `ios/App/App/public/`. A stale generated copy therefore cannot vouch for a source that has changed,
  and a clean source cannot excuse a broken copy.
* Script code is checked wherever it lives. Most of this app's code is inline in `index.html`, so inline
  `<script>` bodies are read like a module: a `fetch`, `import`, or `new Worker` against a remote URL fails there
  too. XML namespace constants and the reviewed legal links stay allowed.
* Vocabulary, sentence data, fonts, and licence files are loaded by names the app builds at run time, which no
  reference scan can see, so the inventory is checked by name. The list mirrors `REQUIRED_FILES` in
  `sites/lesen/scripts/verify-bundle.mjs`; the trusted copy is the authority and a test fails if the two drift.
* It is a shape check, not a build: it proves the app is offline and reviewable, not that it runs. Device
  behaviour stays a `physical_device` human task.
* When the project has no iOS shell yet, or no Capacitor configuration at all, the rule checks what exists and
  passes with a note. Android-only and web-only phases are not failed by it.
* After rebuilding the image (`isolation build`) run `isolation verify`: the probe checks that the script is in
  the image and runs there.
* To try it by hand: `docker run --rm --user 10001 -v <repo-dir>:/w:ro -w /w harness-worker:1 sh /opt/harness/smoke/ios_shell.sh /w sites/lesen`
  (the directory must be inside a Docker-shared path, such as your home folder). It also runs on the host:
  `sh tools/harness/worker/smoke/ios_shell.sh "$PWD" sites/lesen`.

## Command reference

Every command is `harness <command>`. Add `--home DIR` before the command to use another store folder.

| Command | Purpose | Options |
|---|---|---|
| `start` | One guided path: environment, investigate, plan, approve, import, run. Resumes where the store says you stopped. | `--requirements FILE`, `--out DIR`, `--plan-id`, `--tier`, `--model-source` (repeatable), `--repo`, `--redraft` |
| `investigate` | Draft phases and issues from requirements. Asks you questions. | `--requirements FILE` (required), `--out DIR`, `--tier low\|standard\|strong` (default standard), `--model-source copilot\|deepseek\|local` (repeatable, default copilot), `--max-rounds N`, `--non-interactive`, `--answers FILE`, `--feedback TEXT` (repeatable), `--feedback-file FILE`, `--timeout SECONDS`, `--force` |
| `plan` | Validate and save a plan | `--requirements`, `--phases FILE`, `--plan-id`, `--model-source copilot\|deepseek\|local` (repeatable, default: the phases file, else copilot), `--assets-dir DIR` (per-plan asset directory, default `assets/`), `--overseer` / `--no-overseer` (top-tier overseer answers process blocks; default off), `--dry-run`, `--fixture` |
| `models` | Show the picker menu per source and which ids this runtime accepts | `--source copilot\|deepseek\|local` (repeatable), `--refresh` |
| `approve PLAN_ID` | Record your one-time approval (real terminal) | `--version` |
| `import-issues PLAN_ID FILE` | Load refined issues as Ready | `--version`, `--add` (add the file's issues and leave the plan's other issues alone) |
| `run PLAN_ID` | Execute the plan, in the foreground | `--dry-run`, `--interval SECONDS` (30), `--max-ticks N`, `--repo OWNER/NAME`, `--version`, `--no-tunnel` |
| `resume PLAN_ID` | Continue a paused or interrupted run | same as `run` |
| `pause PLAN_ID` | Stop after current work (graceful) | `--now`, `--after-phase PHASE_ID` (finish that phase, start nothing outside it and its prerequisites, then stop; also arms the gate on an already paused plan) |
| `cancel PLAN_ID` | Stop for good | `--drain` |
| `gui` | Local monitoring and management; auto-starts the remote dashboard when `HARNESS_GUI_PIN` is set | `--host 127.0.0.1\|localhost`, `--port` (8765, or 0 for a free port), `--refresh` (5 seconds), `--read-only`, `--no-browser`, `--no-tunnel`, `--repo OWNER/NAME` |
| `remote` | PIN-locked loopback relay that proxies the local GUI for a tunnel (operator override) | `--upstream URL` (http://127.0.0.1:8765), `--host 127.0.0.1\|localhost`, `--port` (8443, or 0), `--pin`, `--session-hours` (12) |
| `status` | Everything at a glance (read-only) | `--json` |
| `report <plan>` | Publish the run's state as a markdown page on `harness/status/<plan>` | `--once`, `--interval`, `--no-push`, `--branch`, `--repo` |
| `issue ID` | One issue in detail (read-only) | `--json` |
| `tasks` | Open human tasks, explained | none |
| `respond TASK_ID` | Answer a human task | `--option`, `--guidance`, `--outcome`, `--tester`, `--revision`, `--notes`, `--evidence`, `--artifact`, `--answer KEY=VALUE`, `--ack` |
| `sync PLAN_ID` | Create the GitHub work record (requirements issue, milestones, phase issues) | `--dry-run`, `--repo`, `--allow-author` |
| `sync-tasks PLAN_ID` | Mirror open tasks as GitHub issues | `--dry-run`, `--repo` |
| `isolation build\|verify\|status` | Build, verify, or show the worker sandbox | none |
| `probe` | Read-only GitHub capability check | `--repo` |
| `assets probe` | Check whether Blender is available | none |

`investigate` exit codes: 0 draft written, 1 no valid draft (see `rejected-draft.json`), 2 refused, 3 needs answers (see `questions.md`), 130 stopped by you.

`investigate` details: answer prompts with a number to pick an option, with text, with Enter to let the investigator decide, or `quit` to stop (your answers are saved). Without a terminal use `--non-interactive`, put answers in a JSON file like `{"q1": "web only"}`, and rerun with `--answers FILE`. A rejected draft is retried with the problems and a stronger model. `--feedback` revises your existing draft, treats your feedback as authoritative, keeps the old version in `history/rev-N/`, and never replaces your draft with an invalid one.

**Issue file format** for `import-issues`: a list of objects with `issue_id`, `phase_id`, `requirement_ids`, `outcomes`, `acceptance_criteria`, `non_goals`, `code_anchors`, and optionally `title`, `contract_paths`, `deps`, `validation_commands`, `parallel_safe`, `model_choices`. The investigator writes these for you, including concrete models and reasons for `implementer`, `reviewer`, and `refiner`. Older issue files may omit `model_choices`.

**Defaults** (all part of the approved plan): no run wall-clock limit and no pull-request or issue cap, so a run keeps scheduling until its issues are Done or you pause it; 2 workers at once, only for issues marked parallel-safe (otherwise one at a time); 2 automatic repair attempts and 3 transient retries per issue; 30 minute worker limit and 10 minute inactivity limit; at most 1 strong-tier implementation attempt per issue; at most 1 delegating-agent consultation per issue; autonomous merge only when every gate passes and no escalation path is touched.

**Merge gates** (code checks all of these): approval digest valid, checks passed on the current head and base, independent review approved for that head, changes only inside the phase path allowlist, no escalation paths touched, diff under the size cap, and, where required, a passing manual test. Escalation paths always need a human: workflow files, the harness itself (`tools/harness/`, `docs/harness/`, `.github/`), dependency manifests (including nested `package.json` and lockfiles), Android build and permission files, infrastructure, and migrations. The Godot and Android release surface is included: any `export_presets.cfg` (it holds signing settings), any `addons/` directory at any depth (third-party code such as a vendored test framework), `apps/arithmoslayer/android/` (the Android build template), and plugin and store binaries by suffix (`*.gdextension`, `*.so`, `*.dylib`, `*.dll`, `*.aar`, `*.jar`, `*.apk`, `*.aab`, `*.keystore`, `*.jks`).

## The run branch keeps `main` free

A new plan runs on its own protected branch instead of `main`. `policy.run_branch` defaults to
`harness/run/{plan}`, so `harness run` (or **Start run** in the dashboard) creates
`harness/run/<plan-id>` at the current `main` head before the first worker starts and then treats it as the base
branch: workers branch off it, pull requests target it, rebases follow it, and the merge gates verify *its*
protection. An existing branch is reused, so a resumed run continues where it stopped instead of restarting.

Protection is the repository ruleset `harness run branches`, which covers `refs/heads/harness/run/**` with the same
rules as `main`: no direct pushes, no force pushes, and the strict required checks `test` and `test-ffm` before a
merge. The harness verifies those rules before it runs, exactly as it does for `main`, and never changes them.

When every phase is Done, the harness opens a pull request from the run branch into `main` and emits `promotion_pr`.
It does not merge it: `main` moves when you decide, and the deploy that follows belongs to that merge. Run branches
may be deleted after promotion; `main` itself stays protected against deletion.

Set `policy.run_branch` to `""` to work directly on the base branch as before, and `policy.base_branch` when the
repository's base is not `main`. Both are part of the approval digest.

## Where things live

| What | Where |
|---|---|
| All state (plans, issues, attempts, evidence, tasks, journal, events) | `~/.local/state/derschweigert-harness/harness.sqlite` (read with `status` and `issue`; do not edit by hand) |
| Approval signing key, tokens, sandbox attestation, model cache | the same folder: `approval.key`, `broker.token`, `copilot.token`, `isolation.json`, `models.json` |
| The harness's own copy of the repository | `~/.local/state/derschweigert-harness/trusted-clone.git` (a bare clone; worker branches are inspected here) |
| Proposed splits from the strong analysis, and your optional price file | `analyses/` and `model-prices.json` in the same folder |
| Rehearsal copies of your state | `~/.local/state/derschweigert-harness/rehearsal-<time>/` (safe to delete) |
| Output from GUI-launched coordinators | `gui-runners/` inside the selected state folder; private per-launch log files |
| Throwaway worker folders | `~/.local/share/derschweigert-harness-work/` (cleaned automatically) |
| Investigator output | `<requirements file>_plan/`: `phases.json`, `issues.json`, `investigation-report.md`, `investigation.json`, `history/` |
| Pull requests and branches | GitHub: work branches `harness/<issue-id>`, and one protected run branch `harness/run/<plan-id>` per plan |
| Optional GitHub work record | milestones and issues created by `sync` |

Environment variables: `HARNESS_HOME` (alternative state folder), `HARNESS_WORK_ROOT` (alternative worker folder), `HARNESS_LIVE=1` (enable live tests).

Plans are stored in the database, not in a folder, so they will not show up in your file tree. `harness status` lists them.

## Troubleshooting

| What you see | Cause and fix |
|---|---|
| `isolation: Tier B ... run refused` | The sandbox attestation is missing or older than 24 hours. Run `harness isolation verify`. |
| `error: unknown plan ...` | Wrong plan ID, or a different `--home`. Run `harness status` to see the IDs. |
| `approval none` in `status` | Approve the prepared workspace in Planning, or run `approve` in a real terminal. Type the 12 digest characters exactly. |
| `no issues to schedule` | Run `import-issues` first. |
| `paused: only N GiB free for worker directories` | The disk holding `~/.local/share/derschweigert-harness-work/` is nearly full, and a worker needs a copy of the repository plus its build output. Free space, then `resume`. Each attempt releases its copy when it ends; a crashed or killed runner's copies are reclaimed when the next one starts. |
| `paused: no worker can be started: ...` | The host could not start a worker at all (git clone, docker, disk). Every issue would fail the same way, so the run pauses once instead of raising a decision task per issue. Fix the named cause, then `resume`. |
| `cloning ... timed out after 600s` or `could not clone ...` | Building the trusted clone failed or hung. The clone uses `--no-local`, so it is bounded by `CLONE_TIMEOUT_S` instead of stalling in a local object copy. The incomplete attempt is kept at `<home>/trusted-clone.git.partial-*` for inspection and is never reused: `trusted-clone.git` only ever appears once a clone finished. Read the kept directory, delete it, then run the command again. |
| An issue is `Blocked` | Run `harness tasks`. A blocked issue always has a dependency or a task with the reason. Answer it. |
| `retry would repeat failed attempt ...` | A retry must differ from the failed attempt. Choose option 2 with guidance, or option 3. |
| `validation command ... can never report a failure` | The command ends in `\|\| true` (or `; true`, `\|\| exit 0`). A check must be able to fail: drop the fallback and let the command report its exit code. |
| `... does not exist at the base revision and is not inside the phase path allowlist` | The check names a file no worker may create. Fix the command or add the path to the phase's `path_allowlist`, then prepare a new plan version. |
| `investigate` shows nothing for a while | It is working: reading the repository takes a few minutes, and a progress line prints every 15 seconds. It stops after 10 quiet minutes. |
| Containers left after Ctrl+C | `docker ps -a \| grep harness`, then `docker rm -f NAME`. |
| `copilot.token` rejected or expired | Create a new fine-grained token (Copilot Requests permission, no repository access), save it to `~/.local/state/derschweigert-harness/copilot.token` with mode 600, and rerun `isolation verify`. |
| `harness pause` does nothing | The running process started before `pause` existed. Stop it with Ctrl+C and restart with `resume`. |
| `[CopilotCLIAgents] Failed to fetch custom agents: Canceled` | A harmless VS Code Copilot panel message, unrelated to the harness. |
| `FAIL: ... sets server.url` or `FAIL: ... does not parse as a property list` | The iOS shell check. A `server.url` makes the app load from the network; an unparsable `Info.plist` or `PrivacyInfo.xcprivacy` fails closed. Fix the file, or run `sh tools/harness/worker/smoke/ios_shell.sh "$PWD" sites/lesen` locally to see every problem at once. |
| `FAIL: ... is missing the required runtime file ...` | The bundle does not carry a file the app loads by a name built at run time (vocabulary, sentences, licences). Add it to `sites/lesen/static/`, or, if the file is genuinely gone, change the inventory in `worker/smoke/ios_shell.sh` and the product verifier together. |
| `FAIL: ... references ..., which does not exist in the bundle` | The web bundle is incomplete: a page, stylesheet, or module points at a file that is not shipped. Add the file to `sites/lesen/static/` or fix the reference; the bundle must work with no network. |
| A deploy failed on `main` | The harness only merges. Open the Actions run and fix or rerun the deploy. |

## Safety, limits, and known gaps

What is enforced:

* Workers run in a locked-down container (non-root, read-only root filesystem, no capabilities, resource limits) and see only their task folder. They never hold GitHub write credentials, the approval key, or the store. Only the harness broker writes to GitHub, and it checks every action against the approved plan.
* Approval is bound to a digest of the scope and policy. A changed plan, a forged approval, or an expired sandbox attestation stops execution.
* The broker and scheduler enforce the signed `authorized_operations` list. Branch creation, commits, pushes, pull requests, and eligible merges cannot inherit permissions omitted from the approval.
* Evidence is bound to exact commits and actual base ancestry. Remote base changes trigger rebasing and fresh checks; only an unchanged patch can retain its review. GitHub must report the exact reviewed head as merged.
* Real merges require verified strict required checks enforced for administrators, preventing an external base change between the final fetch and the merge from bypassing validation.
* Asset request identifiers cannot contain paths. Outputs, manifests, scripts, existing assets, and human-upload destinations are checked for traversal and symlink escapes.
* Nothing is merged for escalation paths, out-of-scope changes, failed checks, or stale evidence.
* The worker toolchain is pinned and verified. The Godot binary matches the official SHA512 of its release, GUT is pinned to a commit that `git` verifies at build time, and gdtoolkit is pinned by version. The Tier A probe fails unless `godot` and `gdlint` report the pinned versions and a throwaway project imports headless under the read-only root filesystem.

What is not, honestly:

* A repository whose plan cannot provide the required server-side protection cannot use autonomous merging. Convention alone is insufficient; unverifiable protection is a blocker, not an exemption.
* The worker sandbox has open outbound network access. A worker could send out its task folder or its Copilot-only token.
* `broker.token` is a broad classic token. Treat the store folder as sensitive.
* Blender runs on your machine, not in the sandbox. Host execution refuses scripts unless trusted code explicitly allowlists the exact reviewed script through `BlenderCli(reviewed_scripts=...)`. Worker requests cannot grant that permission. The blocklist remains defense in depth, not isolation; prefer submitting the generated asset through a human task.
* The overseer is **off unless the plan asks for it** (`harness plan --overseer`), because the harness has always held that budgets and policy are decided by trusted code rather than by a model. With it on, it removes process questions from your queue, not judgement. It cannot cancel, approve, merge, or change policy, and it cannot touch `tools/harness/`: a harness defect it finds becomes a decision task with its diagnosis attached, which you still have to act on. It is bounded per issue (`policy.overseer.rounds_per_issue`, default 2) and never runs on an authority failure such as a scope breach or an isolation problem.
* The individual work issues are not mirrored to GitHub: they exist only in the harness store, so use `status` and the pull requests for progress. GitHub Project fields are not synced.
* If a person merges a harness pull request on GitHub, the harness does not notice.
* Token and cost figures are estimates. The runtime reports no usage, so each attempt records the agent's own estimate and a lower bound from prompt and file sizes. `status`, `issue`, and the dashboard label every figure by source, and nothing enforces them. Cost appears only if you add prices.
* The local dashboard is not a remote administration service. It has no separate user authentication, persistent process registry, or cross-dashboard singleton lock. `harness remote` is a documented operator override: a loopback-only, PIN-locked relay that proxies the dashboard for a tunnel. It is not the default posture.
* Phase-wide exit checks run only when a phase is validated. Each issue is checked with its own commands.
* Headless Godot does not render. No automated check covers how the game looks, whether a shader compiles into the intended effect, or how many frames a device draws. Loadability is not correctness: a passing Godot smoke check means the scenes and scripts parse and instantiate, nothing more.
* The Godot smoke check and `godot-test` work on a copy of the project inside the container's 256 MB `/tmp` tmpfs. A project larger than that cannot be checked until the sandbox sizes change, which invalidates the attestation.
* GUT is image content, not repository content. A change to the test framework is a harness and image change reviewed here, never part of a worker's pull request; a worker that adds or edits `addons/` is escalated to you.

## Upgrading safely

Publishing a harness fix is separate from applying it to a running coordinator.
Prepare maintenance changes in a separate Git worktree, add regression tests,
and merge a harness-only pull request into `main` after the required checks pass.
Leave the active checkout, run branch, store, approved policy and worker image
untouched. This also applies to subsequent fixes discovered during a run:
publishing them does not require restarting or upgrading that run.

When applying a published fix to the runtime:

1. Pause the existing run and confirm its process has stopped before replacing
  harness code. An already-running process retains its old permissions and
  execution paths. Back up the stopped store, including its approval key.
2. Run the offline suite with an interpreter that has pytest installed:
  `HARNESS_LIVE=0 python3 -m pytest tools/harness/tests -q`.
  Temporary Git remotes and local subprocess tests do not require GitHub writes.
3. Verify Tier A isolation and the server-side merge precondition before
  resuming. No rollout step automatically edits GitHub settings or production
  state. Live GitHub, Docker, and Blender verification remains a separate gate.
4. Resume the approved plan. The harness verifies actual ancestry rather than
  trusting saved `base_rev` metadata. A stale base causes fresh checks, and
  expired pending check jobs are discarded and rerun. Recorded merges resume
  at post-merge checks instead of merging a second time.
5. Treat newly surfaced permission, protection, or script-review blockers as
  decisions for the owner. Do not edit signed policy or evidence in the store
  to suppress them. Changed scope or permissions require a newly approved plan
  version; unreviewed procedural requests can be resolved with a human asset.

## Maintaining the harness

```sh
HARNESS_LIVE=0 python3 -m pytest tools/harness/tests -q # offline harness suite
python3 -m pytest -q                                  # root-configured site and harness tests
HARNESS_LIVE=1 python3 -m pytest tools/harness/tests/test_harness_live.py   # real Copilot CLI and Blender; spends a little usage
```

Test doubles (`harness_doubles.py`, `harness_fakes.py`) exist only for fault injection and are labeled as doubles. Bugs found against the real runtime should get a live test, because several of the real-run bugs so far (reviewer, post-merge checks, refiner) were invisible to the doubles.

The [test optimization analysis](../../docs/harness/test-optimization.md)
records serial and two-worker timings, line-coverage overlap, and specific
consolidation candidates. Matching coverage is not permission to remove a test.
GUI HTTP contracts are automated; browser interaction checks currently require
separate end-to-end verification.

After rebuilding the worker image, rerun `harness isolation verify` before resuming.
Do not rebuild an image used by an active run merely to publish its source changes.
Apply runtime code updates only at a stopped, paused boundary as described above;
do not hot-swap files under a running coordinator or its GUI. Record decisions and
limits in [decisions.md](../../docs/harness/decisions.md).

Code map: `cli.py` (commands), `gui.py`, `gui_workflow.py`, `gui_page.html`, and `gui_page.js` (local dashboard and persisted preparation jobs), `investigate.py` (investigator), `plans.py` and `approval.py` (plan, digest, approval), `scheduler.py` (the loop, gates, failures), `adapter.py` and `isolation.py` (runtime and sandbox), `publisher.py` and `github.py` (GitHub), `humantasks.py`, `assets.py`, `status.py`, `store.py` (SQLite state), `machines.py` (state machines).
