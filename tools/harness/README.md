# Harness manual

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
10. [Maintaining the harness](#maintaining-the-harness)

## How it works

```
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
| Attempt | One worker run on an issue (implementer, reviewer, or refiner). Each has a lease that expires after 90 seconds without a heartbeat. |
| Evidence | Test and review results, each tied to the exact commit and base they were produced on. Stale evidence does not count. |
| Tier | The model strength: `low` (Haiku), `standard` (Sonnet), `strong` (Opus). Escalation happens only after failures. |
| Human task | A question the harness asks you: a decision, an asset, or a manual test. |

What an issue goes through: a **refiner** re-checks it if the code under it changed, an **implementer** builds it in a throwaway copy of the repository, the harness runs the issue's own check commands, an **independent reviewer** (a different model) reviews the diff, the harness opens a pull request and merges it when every gate passes, and it reruns the checks on the merged `main`. Only then is the issue Done. A phase is Done when all its issues are Done and its exit checks pass.

**Every merge to `main` deploys to production.** This repository's deploy workflow runs on `main`, so each autonomous merge of a `sites/lesen` change goes live. Keep that in mind when you approve a plan.

## One-time setup

You need:

| Need | Check | Expected |
|---|---|---|
| Python 3.9+ and git | `python3 --version`, `git --version` | installed |
| Docker, running | `docker info` | prints a server version |
| `gh` signed in as the repository owner | `gh auth status` | logged in, scopes include `repo` and `read:project` |
| Worker image | `docker images harness-worker` | `harness-worker:1` is listed |
| Token files | `ls -l ~/.local/state/derschweigert-harness/` | `broker.token` and `copilot.token`, both `-rw-------` |

* `broker.token`: a GitHub token the harness uses to open and merge pull requests. Keep it in the store folder only, never in the repository.
* `copilot.token`: a fine-grained token with only the **Copilot Requests** account permission and no repository access. Workers receive only this one. It expires, so renew it before the date it was issued for.
* Optional: Blender (`blender` on your PATH) for procedural assets.

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

## Quick start

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

Optional extras: `harness sync PLAN_ID` creates a requirements issue, milestones, and phase issues on GitHub for visibility (try `--dry-run` first). It does not create the individual work issues. `run` never creates GitHub issues.

## Everyday use

**Watch progress**

```sh
harness status                    # plan, phases, queue, workers, blockers, tasks, budgets
harness status --json             # the same, machine-readable
harness issue p1-stars-animation  # everything about one issue: scope, attempts, evidence, history (add --json)
```

Reading `status`: `Ready` waits to start, `In Progress` has a worker, `In Review` has a pull request awaiting review or merge, `Blocked` needs a dependency or a human task, `Done` is merged and checked on `main`. The `worker` lines show who is running and for how long. Token and cost figures show as unavailable, because the runtime does not report them.

**Pause, resume, stop**

```sh
harness pause PLAN_ID           # finish the workers in flight, start nothing new, then stop
harness pause PLAN_ID --now     # cancel the workers in flight instead of waiting
harness resume PLAN_ID          # continue a paused or interrupted run
harness cancel PLAN_ID          # permanent: the plan cannot be resumed. --drain lets active workers finish first
```

Ctrl+C in the `run` terminal also stops the loop. It is safe: leases expire, workers are fenced, nothing is marked done by absence, and `resume` carries on. Afterwards check `docker ps | grep harness` and remove leftovers with `docker rm -f NAME`.

Restart the run after you change harness code, because a running process keeps its old code in memory.

**Rehearse without side effects.** `run --dry-run` uses real workers, checks, and reviews but only records pull requests and merges. It works on a throwaway copy of your state (the path is printed; watch it with `harness --home THAT_PATH status`), so your real plan is untouched. It costs the same AI usage as a real run, so use it only if you want a safety net.

## Human tasks and decisions

The harness asks you things through tasks. `harness tasks` lists the open ones with everything you need, and `harness status` shows how many are waiting. Silence never counts as an answer: reminders go out after 24 hours (at most 3), and after 72 hours the secondary owner is notified.

**Decision tasks** are raised by the harness itself when an issue is blocked (budget used up, a policy failure, or a refiner that needs your input). It is not a request from a reviewer or a worker. Each task shows the reason, the recent failures, and these options:

| # | Option | What happens |
|---|---|---|
| 1 | retry as is | The next step runs again with no changes. Use it when the cause looks like a fluke or a harness fault. |
| 2 | give guidance and retry | Same, and your hint goes to the worker. |
| 3 | refine the scope | The issue goes back to be re-planned. Use it when the issue itself is unclear or too big. |
| 4 | cancel the issue | The issue is dropped. Work that depends on it will not run. |

```sh
harness respond TASK_ID --option 1
harness respond TASK_ID --option 2 --guidance "Use the helper in sites/lesen/static/storage.mjs"
```

An issue that already has a pull request and passing checks resumes at review instead of being implemented again. One that is already merged only has its post-merge check redone.

**Asset tasks** ask for a file when no automated source produced a valid one:
`harness respond TASK_ID --answer source=self-made --answer license=CC0-1.0 --answer author=Me --artifact ./crate.glb`.
The file is validated (format, size, polygons, license, no embedded scripts) before it is accepted.

**Manual test tasks** ask you to try something by hand on an exact commit:
`harness respond TASK_ID --outcome pass --tester me --revision COMMIT --evidence screenshot.png`.
A result for an older commit is rejected as stale, and `inconclusive` stays open. A manual pass never replaces the automated checks.

To see tasks on GitHub as well, run `harness sync-tasks PLAN_ID` (mirrors open tasks as issues and mentions you).

## Command reference

Every command is `harness <command>`. Add `--home DIR` before the command to use another store folder.

| Command | Purpose | Options |
|---|---|---|
| `investigate` | Draft phases and issues from requirements. Asks you questions. | `--requirements FILE` (required), `--out DIR`, `--tier low\|standard\|strong` (default standard), `--max-rounds N`, `--non-interactive`, `--answers FILE`, `--feedback TEXT` (repeatable), `--feedback-file FILE`, `--timeout SECONDS`, `--force` |
| `plan` | Validate and save a plan | `--requirements`, `--phases FILE`, `--plan-id`, `--dry-run`, `--fixture` |
| `approve PLAN_ID` | Record your one-time approval (real terminal) | `--version` |
| `import-issues PLAN_ID FILE` | Load refined issues as Ready | `--version` |
| `run PLAN_ID` | Execute the plan, in the foreground | `--dry-run`, `--interval SECONDS` (30), `--max-ticks N`, `--repo OWNER/NAME`, `--version` |
| `resume PLAN_ID` | Continue a paused or interrupted run | same as `run` |
| `pause PLAN_ID` | Stop after current work (graceful) | `--now` |
| `cancel PLAN_ID` | Stop for good | `--drain` |
| `status` | Everything at a glance (read-only) | `--json` |
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

**Issue file format** for `import-issues`: a list of objects with `issue_id`, `phase_id`, `requirement_ids`, `outcomes`, `acceptance_criteria`, `non_goals`, `code_anchors`, and optionally `title`, `contract_paths`, `deps`, `validation_commands`, `parallel_safe`. The investigator writes these for you.

**Defaults** (all part of the approved plan): 2 workers at once, only for issues marked parallel-safe (otherwise one at a time); 2 automatic repair attempts and 3 transient retries per issue; 30 minute worker limit and 10 minute inactivity limit; 8 hour run limit; 20 pull requests per run; at most 1 strong-tier attempt per issue; autonomous merge only when every gate passes and no escalation path is touched.

**Merge gates** (code checks all of these): approval digest valid, checks passed on the current head and base, independent review approved for that head, changes only inside the phase path allowlist, no escalation paths touched, diff under the size cap, and, where required, a passing manual test. Escalation paths always need a human: workflow files, the harness itself (`tools/harness/`, `docs/harness/`, `.github/`), dependency manifests (including nested `package.json` and lockfiles), Android build and permission files, infrastructure, and migrations.

## Where things live

| What | Where |
|---|---|
| All state (plans, issues, attempts, evidence, tasks, journal, events) | `~/.local/state/derschweigert-harness/harness.sqlite` (read with `status` and `issue`; do not edit by hand) |
| Approval signing key, tokens, sandbox attestation, model cache | the same folder: `approval.key`, `broker.token`, `copilot.token`, `isolation.json`, `models.json` |
| The harness's own copy of the repository | `~/.local/state/derschweigert-harness/trusted-clone.git` (a bare clone; worker branches are inspected here) |
| Rehearsal copies of your state | `~/.local/state/derschweigert-harness/rehearsal-<time>/` (safe to delete) |
| Throwaway worker folders | `~/.local/share/derschweigert-harness-work/` (cleaned automatically) |
| Investigator output | `<requirements file>_plan/`: `phases.json`, `issues.json`, `investigation-report.md`, `investigation.json`, `history/` |
| Pull requests and branches | GitHub, branches named `harness/<issue-id>` |
| Optional GitHub work record | milestones and issues created by `sync` |

Environment variables: `HARNESS_HOME` (alternative state folder), `HARNESS_WORK_ROOT` (alternative worker folder), `HARNESS_LIVE=1` (enable live tests).

Plans are stored in the database, not in a folder, so they will not show up in your file tree. `harness status` lists them.

## Troubleshooting

| What you see | Cause and fix |
|---|---|
| `isolation: Tier B ... run refused` | The sandbox attestation is missing or older than 24 hours. Run `harness isolation verify`. |
| `error: unknown plan ...` | Wrong plan ID, or a different `--home`. Run `harness status` to see the IDs. |
| `approval none` in `status` | You have not run `approve` yet, or it was declined. Run it in a real terminal and type the 12 digest characters exactly. |
| `no issues to schedule` | Run `import-issues` first. |
| An issue is `Blocked` | Run `harness tasks`. A blocked issue always has a dependency or a task with the reason. Answer it. |
| `retry would repeat failed attempt ...` | A retry must differ from the failed attempt. Choose option 2 with guidance, or option 3. |
| `investigate` shows nothing for a while | It is working: reading the repository takes a few minutes, and a progress line prints every 15 seconds. It stops after 10 quiet minutes. |
| Containers left after Ctrl+C | `docker ps -a \| grep harness`, then `docker rm -f NAME`. |
| `copilot.token` rejected or expired | Create a new fine-grained token (Copilot Requests permission, no repository access), save it to `~/.local/state/derschweigert-harness/copilot.token` with mode 600, and rerun `isolation verify`. |
| `harness pause` does nothing | The running process started before `pause` existed. Stop it with Ctrl+C and restart with `resume`. |
| `[CopilotCLIAgents] Failed to fetch custom agents: Canceled` | A harmless VS Code Copilot panel message, unrelated to the harness. |
| A deploy failed on `main` | The harness only merges. Open the Actions run and fix or rerun the deploy. |

## Safety, limits, and known gaps

What is enforced:

* Workers run in a locked-down container (non-root, read-only root filesystem, no capabilities, resource limits) and see only their task folder. They never hold GitHub write credentials, the approval key, or the store. Only the harness broker writes to GitHub, and it checks every action against the approved plan.
* Approval is bound to a digest of the scope and policy. A changed plan, a forged approval, or an expired sandbox attestation stops execution.
* Evidence is bound to exact commits. A merge is bound to the reviewed commit. Reviews come from a different model than the implementer.
* Nothing is merged for escalation paths, out-of-scope changes, failed checks, or stale evidence.

What is not, honestly:

* Branch protection is not enforced by GitHub on this plan. It is applied by convention: workers push only to `harness/*` branches, never force, and change `main` only through pull requests.
* The worker sandbox has open outbound network access. A worker could send out its task folder or its Copilot-only token.
* `broker.token` is a broad classic token. Treat the store folder as sensitive.
* Blender runs on your machine, not in the sandbox. Worker-written Blender scripts are only screened by a blocklist.
* The individual work issues are not mirrored to GitHub: they exist only in the harness store, so use `status` and the pull requests for progress. GitHub Project fields are not synced.
* If a person merges a harness pull request on GitHub, the harness does not notice.
* Token and cost usage per attempt is unavailable, because the runtime reports none.
* There is no dashboard. `status` is the monitoring interface.
* Phase-wide exit checks run only when a phase is validated. Each issue is checked with its own commands.

## Maintaining the harness

```sh
python3 -m pytest -q                                   # the whole suite, including the harness (about 12 seconds)
HARNESS_LIVE=1 python3 -m pytest tools/harness/tests/test_harness_live.py   # real Copilot CLI and Blender; spends a little usage
```

Test doubles (`harness_doubles.py`, `harness_fakes.py`) exist only for fault injection and are labeled as doubles. Bugs found against the real runtime should get a live test, because several of the real-run bugs so far (reviewer, post-merge checks, refiner) were invisible to the doubles.

After changing the worker image, rerun `harness isolation build` and `harness isolation verify`. After changing harness code while a run is active, restart the run. Record decisions and limits in [decisions.md](../../docs/harness/decisions.md).

Code map: `cli.py` (commands), `investigate.py` (investigator), `plans.py` and `approval.py` (plan, digest, approval), `scheduler.py` (the loop, gates, failures), `adapter.py` and `isolation.py` (runtime and sandbox), `publisher.py` and `github.py` (GitHub), `humantasks.py`, `assets.py`, `status.py`, `store.py` (SQLite state), `machines.py` (state machines).
