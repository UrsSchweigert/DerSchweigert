# Incremental development harness

Plans, approves, and runs phased work on this repository. Trusted Python code owns authorization, scheduling, state, and GitHub writes. Agents propose and perform bounded work inside a Docker sandbox. Requirements and design: [docs/harness/](../../docs/harness/spec.md). Choices and limits: [decisions.md](../../docs/harness/decisions.md).

## Prerequisites

* Python 3.9+, git, Docker (running), and the `gh` CLI signed in as the repository owner.
* Worker sandbox: `python3 -m harness isolation build`, then `python3 -m harness isolation verify`. Rerun `verify` daily, because the attestation expires after 24 hours. Without it the harness drops to Tier B and `run` refuses.
* Store directory `~/.local/state/derschweigert-harness/` (mode 700) holding `broker.token` (GitHub token for the broker) and `copilot.token` (fine-grained token with only the Copilot Requests permission), both mode 600.
* Optional: Blender for procedural assets (`blender` on PATH).

All commands: `PYTHONPATH=tools python3 -m harness <command>` from the repository root. Add `--home DIR` to use another store.

## Workflow

```sh
# 0. Let the investigator study the app and draft the phases and issues. It asks you questions in the terminal when it is blocked.
harness investigate --requirements uploads/20261026_improvements
#    writes uploads/20261026_improvements_plan/{phases.json,issues.json,investigation-report.md}. Read the report before going on.

# 1. Submit requirements. Without --phases the plan stays Draft and lists what is missing.
harness plan --requirements uploads/20261026_improvements --phases uploads/20261026_improvements_plan/phases.json
harness plan --requirements uploads/20261026_improvements --phases phases.json --dry-run   # preview only

# 2. Approve once. Needs an interactive terminal: type the first 12 characters of the digest.
harness approve 20261026-improvements

# 3. Optionally create the GitHub work record. Dry run first.
harness sync 20261026-improvements --dry-run
harness sync 20261026-improvements

# 4. Load the refined implementation issues the investigator drafted (you can edit the file first).
harness import-issues 20261026-improvements uploads/20261026_improvements_plan/issues.json

# 5. Run. Foreground and restartable. --dry-run uses real workers but records PRs and merges instead of making them.
harness run 20261026-improvements --dry-run
harness run 20261026-improvements

# 6. Watch.
harness status
harness status --json

# 7. Answer human tasks.
harness tasks
harness respond decision-i1-1 --option "supply guidance or an asset" --guidance "use the helper in src/x.py"
harness respond asset-r1 --answer source=self-made --answer license=CC0-1.0 --answer author=Me --artifact ./crate.glb
harness respond m1 --outcome pass --tester me --revision <head sha> --evidence screenshot.png
harness sync-tasks 20261026-improvements        # mirror open tasks as GitHub issues so the owner is mentioned

# 8. Stop, pause, resume.
harness cancel 20261026-improvements             # --drain lets active workers finish first
harness resume 20261026-improvements
```

`harness` above stands for `PYTHONPATH=tools python3 -m harness`.

### The investigator (`investigate`)

Needs a verified sandbox (`isolation verify`). It runs the real Copilot CLI in the container, reads the repository, and either asks you up to 5 questions per round (3 rounds at most) or returns a plan. Code then checks the plan: every requirement covered, no cycles, allowlists that avoid harness-protected paths, anchors that exist, safe validation commands. A rejected draft is sent back with the problems, on a stronger model. Nothing is approved or written to GitHub.

* Answer prompts with a number (picks an option), text, Enter (let the investigator decide), or `quit` (stop, answers are kept, rerun to continue).
* No terminal, or you prefer files: add `--non-interactive`. It writes `questions.md` and exits with code 3. Put your answers in a JSON file such as `{"q1": "web only"}` and rerun with `--answers answers.json`.
* Useful options: `--out DIR`, `--tier low|standard|strong` (default standard), `--max-rounds N`, `--timeout SECONDS`, `--force` (replace an existing draft).
* Exit codes: 0 draft written, 1 no valid draft (see `rejected-draft.json`), 2 refused, 3 needs answers, 130 stopped.

Issue file shape for `import-issues`: a list of objects with `issue_id`, `phase_id`, `requirement_ids`, `outcomes`, `acceptance_criteria`, `non_goals`, `code_anchors`, and optionally `title`, `contract_paths`, `deps`, `validation_commands`, `parallel_safe`.

## What must stay running

`run` and `resume` are foreground processes. They hold nothing that cannot be rebuilt. If one stops, leases expire in 90 seconds, workers are fenced, and no work is marked complete. `resume` reconciles from the store. To keep it running unattended, start it under a supervisor such as `launchd` or `tmux`. Nothing else needs to stay up except Docker.

## Tests

```sh
python3 -m pytest -q                                   # everything, including the harness
HARNESS_LIVE=1 python3 -m pytest tools/harness/tests/test_harness_live.py   # real Copilot CLI and real Blender, spends a little usage
```

Test doubles (`harness_doubles.py`, `harness_fakes.py`) are for fault injection only and are labeled as such.
