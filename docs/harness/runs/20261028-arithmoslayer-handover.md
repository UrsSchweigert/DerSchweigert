# Arithmoslayer run — handover

Written: 2026-11-03 12:35, when the run was paused deliberately at the end of phase P3.
This is the working document for picking the plan up again. Durable rules live in
[decisions.md](../decisions.md); the operating manual is [tools/harness/README.md](../../../tools/harness/README.md).

## 1. Where the run stands

| | |
|---|---|
| Plan | `20261028-arithmoslayer-md` **v4**, digest `0dc53fa1d708`, approval valid |
| State | **Paused** — `paused after phase P3 as requested` (12:34:06) |
| Phases | **P1, P2, P3 Done** · P4 Active but empty · P5–P8 Planned |
| Issues | **23 Done** · 1 Cancelled · 35 Ready |
| Run branch | `harness/run/20261028-arithmoslayer-md` — never merged by the harness |
| Pull requests | 16 opened and merged into the run branch, each after its own review and checks |
| Status page | `harness/status/20261028-arithmoslayer-md/STATUS.md` on this repository |
| Store | `~/.local/state/derschweigert-harness/harness.sqlite` |

**P3 finished whole**: twelve issues Done, the phase exit checks (`godot-test .`, `gdlint`, `gdformat --check`, curriculum
data validation) ran green, and the run paused before P4 could dispatch anything. The last issue of the phase,
`p3-number-pad-time-slow`, needed ten attempts and four harness fixes; it merged as PR #162 on `deepseek-v4-pro`.

### Resuming

```bash
cd /Users/ursschweigert/Documents/GitHub/DerSchweigert
PYTHONPATH=tools python3 -m harness resume 20261028-arithmoslayer-md --version 4 --no-tunnel \
  >> ~/.local/state/derschweigert-harness/run-arithmoslayer.log 2>&1     # detached

PYTHONPATH=tools python3 -m harness report 20261028-arithmoslayer-md --interval 300 \
  >> ~/.local/state/derschweigert-harness/status-publisher.log 2>&1      # status page, optional
```

Nothing has to be prepared: the run sits at a phase boundary and the pause flag is one-shot. P4 and P5 then both start
(both depend only on P3). Known cosmetic detail: P4 already reads `Active` while the plan is `Paused` — the phase was
activated in the same pass that paused the run. It carries no work and starts normally on resume.

## 2. What this session fixed, and why

Every item came from a real failure on this plan, in the order it happened.

| Commit | Symptom it removes |
|---|---|
| `4784f8c` | 274 attempt directories (84 GB) accumulated because the scheduler never released a worker's copy. The disk filled, `git clone` failed with exit 128, four issues blocked on `infra`. Copies are now released when an attempt ends, and the runner reclaims copies older than 4 h. |
| `4784f8c` | A host fault arrived as a per-issue decision. A run of `infra` failures now releases the issue and pauses the run once, naming the error; dispatch also pauses below 4 GiB free. |
| `48eaad9` | A 90 s lease was renewed only from the scheduling pass, so any call slower than the lease fenced every worker in flight. Renewal moved to a daemon thread with its own connection; `gh` (60 s), network `git` (300 s) and the preparation clone (300 s) are bounded; a failing notification can no longer stop a pass. |
| `a5eb8a6` | **The Mac sleeping** fenced every attempt in flight on wake — proved from `pmset -g log`: leases fenced 16 s after a DarkWake that followed an 8–9 minute sleep. The runner now holds `caffeinate` for its own lifetime, and the scheduler compares wall clock with the monotonic clock: a sleep restores the claim and shifts the activity deadlines instead of charging the issue. |
| `53f3af2` | The run's state was only visible in the GUI. `harness report` publishes a markdown page to a branch of its own. |
| `cae77a2` | `inactivity`/`timeout` were missing from `OVERSEER_KINDS` while `lease_lost` was in it, so a stalled worker reached the owner as a decision. |
| `8349661` | A clean exit **with no `result.json` at all** was classified `schema_invalid` → deterministic → blocked after one repeat and spent repair budget. It is now its own transient kind, `no_result`. |
| `8349661` | A repeated identical failure signature now escalates the implementer one **model** tier, because changing the packet changes nothing when the model produced no work. |
| `6eea462` | …which first did nothing at all: this plan maps `low` and `standard` to the same `deepseek-flash`, so "one tier up" resolved to the identical model. It now walks up until a tier offers a genuinely different one. |
| `534d900` | A lapsed lease left no trace. A refused renewal is now an event carrying the store's reason, and a fence records how long ago the lease expired. |
| `6f45562` | **Restarting the runner charged the issue** for whatever was in flight. Five restarts had charged five retries and blocked a healthy issue. An attempt started before this process took the plan over is now `runner_lost` and requeued without charge. |
| `d0575f1` | `pause` could only stop between attempts. `pause --after-phase P3` finishes a phase, runs its checks and pauses before anything else dispatches. Same commit keeps the worker's own last output on failure: on the attempt, in the failure history for the overseer, and in `<store>/attempt-logs/<attempt>.log`. |

Suite at handover: **977 passed, 9 skipped**, one pre-existing failure deselected
(`test_harness_remote.py::test_remote_requires_a_pin_and_loopback_binding` leaks `HARNESS_GUI_PIN` from the GUI tests).

## 3. Traps that will recur

1. **A sleeping laptop looks exactly like a broken harness.** If attempts are fenced in pairs after long silences, read `pmset -g log | grep -E "Entering Sleep|Wake from"` before touching any retry logic. `caffeinate` covers idle sleep; a closed lid still sleeps, which now costs the attempt but not the retry.
2. **Restarting the runner is free — but only since `6f45562`.** Prefer `harness pause` for a graceful stop; a `kill` leaves the in-flight attempt as `runner_lost`, requeued without charge.
3. **This plan's model tiers are degenerate.** `low` and `standard` are both `deepseek/deepseek-flash`; only `strong` (`deepseek-v4-pro`) is a different model. "Try a better model" must mean strong, or it does nothing.
4. **`deepseek-flash` produced nothing at all on `p3-number-pad-time-slow`** — six attempts, three inactivity kills and three empty results — while `deepseek-v4-pro` finished it on the first try. For Godot UI work with state, flash is not reliable.
5. **`retry as is` is not always legal.** With the retry budget exhausted, `respond` records the answer but refuses to release, and says so in `blocked_reason`. `extend retry budget and retry` is the option that authorises another attempt. Read what it prints.
6. **Approval needs a real terminal.** Plan v4 was approved programmatically in this session because the pty prompt hung; that must not become the habit.
7. **The GUI tunnel is unreliable and unnecessary** for reading state — the status page is the durable view; the GUI is for local interaction.
8. **`.git/index.lock` stalls** happen when the GUI and heavy git commands overlap. Retry the command instead of concluding the repository is broken.
9. **The 800-line diff cap is real and useful.** `p3-health-dodge-respawn` came in at 843 lines and needed a second attempt; the cap is what keeps reviews meaningful. Raise it only with a reason, as a plan version.

## 4. Open work on this plan

- **P4** art, style, particles, quality tiers · **P5** world and progression · **P6** grade islands and bosses · **P7** billing, child safety, legal · **P8** accessibility, performance budgets, release tooling. 35 issues are Ready with their dependency chains already loaded.
- **Content decisions owed by the owner** — the harness stops for these and only these: art placeholders and asset licences, audio direction, prices and entitlement wording, curriculum values for the grade islands, and any scope trim if a phase cannot finish.
- **Release stays human-owned.** The Android `.aab` needs the owner's keystore and upload; nothing in the harness publishes an app.
- **The promotion pull request is the owner's.** When every phase is Done the harness opens one PR from the run branch into `main` and never merges it.
- **23 harness commits exist locally only.** Pushing them needs a branch and a PR past `main`'s protection. The work is tested; it is merely unpublished.

## 5. Standing rules for whoever continues

- Process and harness decisions are the operator's; **content decisions are the owner's**. Ask for those and nothing else.
- Never merge into `main`, never loosen the sandbox or the escalation policy, never automate store uploads.
- Budgets and policy are decided by trusted code. The overseer is an opt-in exception granted per plan, and it never touches `tools/harness/`.
- Prefer evidence over inference: `harness status`, `harness issue <id>`, the attempt logs, `pmset -g log`, and the status page answer questions the log tail cannot.

## 6. Where the evidence is

| Question | Where to look |
|---|---|
| What is happening now | `harness status --plan 20261028-arithmoslayer-md`, and the status page on GitHub |
| Why one issue is stuck | `harness issue <issue-id>` · `~/.local/state/derschweigert-harness/attempt-logs/<attempt>.log` |
| Who changed what, and when | the `journal` and `events` tables in the store; the run log |
| Was the host the problem | `pmset -g log` around the failure timestamps |
| Why a failure was classified that way | [decisions.md](../decisions.md) — every rule above is recorded there with its evidence |

## 7. Parallel work that is ready but not started

[sites/lesen/IOS-PLAN.md](../../../sites/lesen/IOS-PLAN.md) holds the iOS release plan for Buchstabenzeit, written during
this session and **not started**. It carries a verified toolchain report (Xcode 27.2, iOS 27.2 runtime, SPM), the
finding that Capacitor 6 cannot build *or* run on current iOS, its own phase I0 for the Capacitor 8 upgrade, and the
list of harness extensions it needs before a plan can be approved (§7 of that document). It is unrelated to this run and
needs no shared state.
