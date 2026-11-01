# Buchstabenzeit: self-contained Android release plan (free download, one-time unlock)

Updated: 2026-10-22

Status: implementation plan with agent-system design approved on 2026-10-22.
No Android application or custom agent configuration has been created yet.

## 1. Goal and agreed scope

Maintain one shared learning application for two release channels:

- Website: continue improving and deploying `lesen.derschweigert.de`.
- Android: periodically publish a tested snapshot as a free download through
  Google Play, with a one-time in-app purchase that unlocks all letters
  (see section 6).

The app is an adult-led reading activity: an adult selects exercises, supervises
the child reading, and marks answers. Read-aloud is optional assistance, not a
guaranteed pronunciation model for arbitrary short letter combinations.

The Android package will contain all application code, exercises, vocabulary,
fonts, images, and legal notices. Core reading practice must work on first launch
without an internet connection, account, backend, or access to the website.

Revised audio decision:

- Use the device's text-to-speech facilities when a suitable installed voice is
  available.
- Do not bundle recordings, a speech model, or a speech engine.
- Do not require a voice download or online speech service to use the app.
- If suitable speech is unavailable, explicitly explain this; the adult can
  continue the entire exercise without audio.

This supersedes the earlier proposal to record every possible card. It removes
the audio-production workstream and its licensing, storage, and review costs.

## 2. Architecture

Use Capacitor as a small Android shell around bundled web assets, not a Trusted
Web Activity that loads the live website.

```text
Shared web source and local assets
    |
    +--> Website deployment --> lesen.derschweigert.de
    |
    +--> Selected, tested source revision
             |
             +--> Copy shared assets into Android project
             +--> Add native device-speech integration
             +--> Build signed Android App Bundle
             +--> Internal testing --> approved Play release
```

Implementation principles:

- Keep `static/` as the shared application source unless implementation reveals
  a concrete reason to change it.
- Add an Android/Capacitor project under `sites/lesen/`, with a locked dependency
  manifest, reproducible asset-copy command, and documented build instructions.
- Extract only the JavaScript needed for speech integration and focused tests.
  Do not introduce a UI framework or duplicate the exercise logic.
- Use Capacitor's local asset origin so relative word-list requests work offline.
- Do not configure a remote application URL, live-update service, CDN assets, or
  essential remote configuration in release builds.
- Treat copied Android web assets as build output; never edit a second app copy.
- Use a minimal platform adapter: browser speech on the website and native
  Android text-to-speech in the packaged app.
- Preserve the existing website's deployment and learning behaviour.

The current static assets occupy approximately 1.8 MB, including 4,365 word-list
entries. The Android runtime adds package overhead; measure actual release size
rather than promising a specific download size.

## 3. Device speech and accessibility

### Text-to-speech is not the same as a screen reader

Android text-to-speech can speak the current card without TalkBack being enabled.
TalkBack independently provides accessible navigation and announcements. Support
both; do not require users to enable a screen reader to hear a card.

### Speech implementation

1. Spike native speech on the physical Android device before building the full
   release workflow.
2. Evaluate a maintained Capacitor speech plugin for required capabilities and
   licence suitability. If it cannot inspect local voice availability and
   network requirements, use a small project-local Android plugin instead.
3. Initialize Android `TextToSpeech` asynchronously and surface initialization
   failure, unsupported language, missing voice data, and playback errors.
4. Request the exercise content's locale, initially `de-DE`. Prefer a compatible
   installed voice from the user's configured engine; do not assume every
   engine supplies every locale or fall back to an unrelated language.
5. Use only voices advertised as not requiring a network connection. Reject
   voices marked as not yet installed. Validate actual offline playback; engine
   metadata alone is not proof.
6. Do not silently switch to network-dependent speech. If no suitable local
   voice exists, show an accessible explanation and optional instructions for
   installing device voice data outside the app. No automatic download.
7. Keep the normal exercise controls fully usable without speech.
8. Cancel queued speech on card changes, leaving practice, and backgrounding.
   Release native resources when appropriate.
9. Preserve explicit browser speech error handling on the website. Explain that
   browser/device speech may differ from Android's offline-only policy.

The application can restrict which voice it requests, but it cannot fully audit
third-party speech engines or screen readers. Privacy statements must distinguish
the app's behaviour from separately configured device services. Do not claim that
every installed service is guaranteed never to communicate externally.

### Accessibility

- Preserve semantic controls, labels, keyboard access, and visible focus.
- Set the document and card language correctly.
- Test TalkBack reading order, focus transitions, text scaling, contrast, and
  touch targets.
- Check for duplicate or conflicting announcements from live regions and the
  explicit read-aloud button; avoid automatically speaking every card.
- Explain short-pattern pronunciation limitations in adult-facing help.

### Future languages

- Pass an explicit content locale through the speech adapter; never infer the
  exercise language solely from the device UI language.
- Keep vocabulary metadata and pronunciation configuration language-aware.
- Avoid hard-coded German assumptions in newly extracted speech code.
- Do not build a language selector or translate the app in this first release.
  New languages still require curated vocabulary, applicable licences, exercise
  rules, UI decisions, and device-voice testing.

## 4. Implementation phases

### Phase A: offline and speech feasibility

- Confirm package identifier, minimum Android version, and supported devices.
- Install a minimal local-asset build on the user's Android device.
- Verify relative assets and word-list loading without connectivity.
- Prove native speech, missing-voice handling, cancellation, and TalkBack
  coexistence.
- Stop and resolve incompatible speech/plugin behaviour before expanding scope.

### Phase B: shared app integration

- Add the small speech adapter and corresponding focused tests.
- Preserve all current card modes, selection rules, marking, and retry behaviour.
- Bundle all assets and notices, including vocabulary and font licences.
- Add concise adult-supervision and optional-speech guidance.
- Keep the website's existing browser speech path working.

### Phase C: production Android shell

- Configure package identity, icons, splash, safe areas, and release settings.
- Implement predictable Back behaviour across setup, practice, and completion.
- Handle application lifecycle and speech cleanup.
- Restrict native-bridge access to trusted bundled content; open external legal
  or help links outside the privileged app view.
- Avoid unnecessary permissions, analytics, ads, and remote dependencies.
- Add bundled version/about, privacy, and attribution screens.

### Phase D: reproducible release workflow

- Provide commands for dependency restoration, asset synchronization, tests,
  debug installation, and release bundle creation.
- Use an explicit Android release trigger, such as a manual workflow or release
  tag; do not publish on every website deployment.
- Record source revision, app version, increasing Android version code, and
  release notes.
- Keep upload credentials out of source control. Enable Play App Signing and
  document credential recovery and ownership.
- Build in CI where suitable; initially retain human approval for Play uploads
  and publication. Automated Play upload is optional, not required for v1.

### Phase E: verification and Play preparation

- Run focused shared-logic tests and Android integration checks.
- Test a real device and emulator coverage for supported Android versions.
- Set up the in-app purchase product and merchant details.
- Prepare screenshots, description, support contact, privacy policy, audience
  declarations, content rating, and Data safety answers.
- Describe the adult-led workflow honestly. Adult operation alone does not
  establish exemption from Google's Families policies.
- Preserve commercial redistribution notices and attribution for the CC BY-SA
  word list and bundled fonts; review any new dependency licences.
- Validate the current target API and account-specific testing requirements at
  submission time.

### Phase F: handover and first release

- Produce a signed release bundle and install through Play internal testing.
- Test updating from the previous test release, not just clean installation.
- Document the complete update and retirement procedures.
- Submit only after the owner approves pricing, declarations, and device checks.

## 5. Acceptance criteria

| Scenario | Required result |
| --- | --- |
| First launch in airplane mode after installation | All core screens and exercise modes work |
| Website unavailable | No effect on packaged reading practice |
| No TTS engine, no German voice, or initialization failure | Clear accessible explanation; practice remains usable |
| Installed local German voice, airplane mode | Read-aloud works for that supported engine/device |
| Only network-dependent voices available | No silent online fallback |
| Card change, screen exit, or backgrounding | Previous speech stops; no stale queue |
| TalkBack enabled | Controls and focus work; no unavoidable competing announcements |
| Large text and small display | Content remains usable without hidden essential controls |
| Upgrade over prior build | App opens and exercises work without clearing app data |
| Website after shared changes | Existing browser learning and speech behaviour are preserved |
| Packaged assets and licences | All required files present; no runtime website dependency |
| Release reproduction | Documented revision and locked dependencies produce a valid bundle |

## 6. Free download with one-time unlock (decision 2026-11-01, replaces paid model)

- The app has not been publicly released (closed testing only), so no buyer
  needs grandfathering. Set the package to Free before release; free cannot be
  converted back to paid.
- One Google Play managed (non-consumable) product, `unlock_all_letters`, removes
  the free-tier limit. No subscription, own purchase backend, or own licence server.
- Free tier limits letter selection only: up to 5 consonants, 5 vowels and 1
  special sound (from the active language's special list) per round of cards.
  Words and sentences modes are not limited. There is no time-based trial.
- Gating lives only in a platform-neutral `entitlement-adapter` in shared
  `static/` code. The website always reports "unlocked". A test must fail if
  gating logic appears outside the adapter, to keep web and app in parity.
- Ownership comes from Play Billing's purchase query (works from cache offline).
  Saved selections above the limit are trimmed on load, never deleted.
- Families policy: the purchase prompt needs a parental gate and calm,
  non-pushy wording; the paywall appears only when a limit is hit.
- Be transparent that the website is available separately and that installed
  offline convenience is part of the app's value.
- Store listing must distinguish offline exercises from conditional device
  speech. Do not promise read-aloud on every device.
- Offline use after installation does not mean installation and purchase are
  independent of Google Play.
- Existing installed copies should remain useful if hosting stops. Future
  Android/WebView compatibility and store availability cannot be guaranteed
  indefinitely.
- Keep the app eligible for maintenance or transfer; document builds and account
  ownership. Consider a standalone package identity suitable for transfer.
- Retirement still requires appropriate communication and compliance with
  applicable consumer, privacy, and digital-product obligations.

## 7. Updating from the website

1. Improve and deploy the shared web app normally.
2. Choose a known-good source revision for an Android update.
3. Synchronize its local assets and review new dependencies and network calls.
4. Run shared tests, offline checks, and speech/accessibility regression checks.
5. Increment version/version code and generate a signed bundle.
6. Install through the internal test track, including an upgrade test.
7. Approve and submit to Google Play.

No website changes silently alter an already installed Android release. New
language support can follow this same process without producing an audio library.

## 8. Agent implementation budget: tokens and currency

These are planning allowances, not measured usage or a fixed-price quote.
Repository familiarity, model choice, context reuse, Android build failures,
plugin suitability, and review iterations can change usage substantially.

Input means cumulative model input tokens across all calls, including repeatedly
supplied context and tool results, not the number of unique source tokens.
Output means billed generated/reasoning tokens where the provider bills them.
Sum parent and subagent usage; delegation is not free.

### Initial release token allowances

| Phase | Input tokens | Output tokens |
| --- | ---: | ---: |
| A: feasibility and device-speech spike | 100,000-300,000 | 10,000-25,000 |
| B: shared app integration and tests | 150,000-450,000 | 15,000-45,000 |
| C: Android shell and lifecycle/accessibility integration | 200,000-600,000 | 20,000-60,000 |
| D: build and release workflow | 150,000-450,000 | 15,000-45,000 |
| E: verification, fixes, and store-material drafts | 300,000-900,000 | 30,000-100,000 |
| F: handover and release support | 100,000-300,000 | 10,000-25,000 |
| **Base total** | **1,000,000-3,000,000** | **100,000-300,000** |
| **Proposed ceiling with 100% contingency** | **6,000,000** | **600,000** |

The ceiling is a proposed spending guardrail, not a prediction. Re-estimate after
Phase A using actual receipts; do not spend through a blocked approach without
owner approval.

### Currency conversion

The approved model families are Opus, Sonnet, and Haiku, assigned by role in
section 9. Exact versions, provider, and billing plan remain to be selected.
The following uniform USD rates are **illustrative sensitivity examples**, not
current vendor prices or a quote for the approved mixed-model system:

| Example budget rate | Input / million | Output / million | Base total | Total with 100% contingency |
| --- | ---: | ---: | ---: | ---: |
| Lower-cost example | $3 | $15 | $4.50-$13.50 | $9-$27 |
| Higher-cost example | $10 | $50 | $15-$45 | $30-$90 |

Formula, before caching, tools, tax, and currency conversion:

```text
cost = sum across models (
    input_tokens_for_model / 1,000,000 * model_input_rate
  + output_tokens_for_model / 1,000,000 * model_output_rate
)
```

Use actual provider rates at execution time. Split uncached input, cache reads,
cache writes, and separately billed reasoning/tools when applicable. Subscription
or Copilot request/credit billing may not map directly to token-priced API costs;
use that system's actual allowance and overage rules instead. These example
figures describe inference charges only, not a commercial development price.

### Approved model-family allocation

Use the existing token envelope provisionally across all five agents, rather
than multiplying it by the number of agents. Planning and review consume part
of that envelope; orchestration does not guarantee lower cost.

| Model family | Roles | Initial share of both input and output allowance |
| --- | --- | ---: |
| Opus | Orchestrator | 10% |
| Sonnet | Planner and reviewer | 30% |
| Haiku | Implementer and executor | 60% |

For budgeting only, the blended input rate is
`0.10 * Opus input rate + 0.30 * Sonnet input rate + 0.60 * Haiku input rate`;
calculate the output rate in the same way. Actual billing must use measured
tokens per model, not assumed percentages. Recalibrate after Phase A.

### Periodic Android update allowance

For a small shared-web update without native changes:

- Input: 100,000-400,000 tokens.
- Output: 10,000-40,000 tokens.
- Lower-cost example: $0.45-$1.80 inference.
- Higher-cost example: $1.50-$6 inference.

SDK upgrades, new languages, accessibility regressions, or native/plugin changes
need a separate estimate. Human device checks and Play review remain necessary.

### Costs and work excluded from token totals

- Android SDK/emulator execution, CI runners, artifact storage, and any paid
  external tools; use existing/local capacity first.
- Existing website infrastructure, which is separate from the installed app.
- Play transaction fees, taxes, refunds, and any merchant/account charges.
- Human review of privacy/legal declarations, target audience, and pricing.
- Real-device checks, accessibility evaluation, tester recruitment, and feedback.
- Closed-test and review waiting periods. Automation cannot replace required
  real testers or the account owner's declarations.
- New-language content creation and linguistic/pedagogical review.

### Agent execution controls

- Work phase by phase, with a bounded objective and verification criteria.
- Prefer direct focused work; use parallel agents only for genuinely independent
  substantial tasks.
- Capture actual billed usage after each phase and update the remaining budget.
- Require owner approval before production publishing, new recurring services,
  credentials changes, or exceeding the spending ceiling.
- If usage cannot be metered or capped by the selected system, report that limit
  explicitly rather than claiming the budget is enforced.

## 9. Approved agentic implementation system

### Roles and authority

The owner approved this five-role design on 2026-10-22. "Haiko" in the original
request is interpreted as Claude Haiku. Pin available model versions when
configuring the system; do not silently substitute another family.

```text
Owner: scope, budget, physical-device checks, publication approval
                              |
                     Orchestrator (Opus)
                              |
                +-------------+-------------+
                |                           |
          Planner (Sonnet)             Reviewer (Sonnet)
                |                           ^
                | bounded task packet       | diff and test evidence
                v                           |
        Implementer (Haiku) --------> Executor (Haiku)
                ^                           |
                +------ bounded fixes ------+
                              |
                     Orchestrator (Opus)
                       accept or escalate
```

All delegation and correction routing goes through the orchestrator. Arrows
represent information flow, not permission for workers to launch other agents.

| Agent | Responsibility | Tools and boundaries |
| --- | --- | --- |
| Orchestrator / Opus | Own objective, dependencies, sequencing, budget, escalation, and final reporting | Read/search, delegation, task tracking; no routine implementation or production publishing |
| Planner / Sonnet | Inspect relevant code; specify bounded tasks, acceptance criteria, risks, and verification | Read/search and documentation lookup; no edits or command execution |
| Implementer / Haiku | Implement one approved task with focused tests and directly related documentation | Read/search/edit and necessary local development commands; no delegation, unrelated edits, or publishing |
| Executor / Haiku | Run approved tests/builds and inspect packaged output; collect actual failures | Read/search/execute; no source edits, arbitrary installations, or production actions |
| Reviewer / Sonnet | Independently assess the diff against the task and execution evidence | Read/search; no edits; return acceptance or actionable findings |

The implementer and executor are separate contexts. Neither self-reported
implementation success nor a passing command alone replaces independent review.

### Bounded task packet

The planner returns the following information for each task. Resolve placeholders
against the repository before handing the packet to the implementer.

```yaml
task: android-offline-asset-loading
objective: All existing reading modes work from bundled assets.
source_revision: <commit and relevant worktree state>
allowed_paths:
  - sites/lesen/
constraints:
  - Preserve website behaviour.
  - No remote application URL.
  - No new recurring service.
acceptance:
  - Fresh installation works in airplane mode.
  - Word mode loads bundled vocabulary.
verification:
  automated:
    - <specific repository commands established during planning>
  manual:
    - <specific physical-device checks>
  human_checkpoint:
    reason: <why a targeted human check is preferable to automation>
    build_or_revision: <exact installed build or website revision>
    steps: <short reproducible actions>
    expected: <observable result>
    report: <pass, fail with observation, or unable to test>
deliverables:
  - implementation and focused tests
  - directly related documentation
  - concise change summary and unresolved limitations
budget:
  max_correction_cycles: 2
  token_allowance: <assigned input and output allowances>
supervision:
  report_interval_seconds: 300
  missed_report_grace_seconds: 120
  no_progress_limit_seconds: 900
  task_deadline: <explicit wall-clock deadline>
  tool_timeouts: <per-command deadlines, including approved long operations>
```

Narrow allowed paths for each task; do not use broad objectives such as "finish
Android support". Changes to release workflows outside `sites/lesen/` require
their own explicitly scoped packet.

### Execution and review loop

1. Opus selects a milestone and checks its prerequisites and available budget.
2. Sonnet plans bounded tasks with verifiable completion criteria.
3. Opus approves the packets and allocates token allowances.
4. Haiku implements one task, reporting changed files and limitations.
5. The Haiku executor runs the approved verification commands and returns
   commands, exit codes, relevant output, and checks it could not perform.
   Where a targeted human check is preferable, Opus explicitly requests it
   using the checkpoint procedure below before dependent work proceeds.
6. The Sonnet reviewer checks requirements, changed code, regressions, and test
   evidence. Findings identify the defect and required correction.
7. Opus accepts verified work or routes a bounded correction. Ambiguous scope or
   an unsuitable approach returns to planning, not repeated blind fixes.
8. After at most two correction cycles, stop that task and escalate. Opus
   resolves architectural questions or requests owner guidance.

Never silently promote a Haiku task to a more expensive implementation model.
Report the blocker and obtain approval for any change to the agreed role/model
assignment.

An automated pass is not evidence of physical-device behaviour. Mark outstanding
manual checks as "awaiting device verification"; do not call the milestone
complete until its acceptance criteria have supporting evidence.

### Mandatory progress reporting and anti-stall supervision

Five-minute reports are required, but prompt instructions alone cannot enforce
wall-clock delivery while a model or blocking tool is stuck. Use two mechanisms:
cooperative agent checkpoints and, where supported, a deterministic runtime
watchdog outside the model's execution loop. Neither a running process nor a
repeated "still working" message proves useful progress.

#### Reporting contract

- Each worker reports directly to Opus, its supervising agent. Planner and
  reviewer are specialist roles, not additional managerial layers. Opus reports
  meaningful progress or blockers to the owner.
- Report at task start, completion, failure, and immediately upon discovering a
  blocker; do not wait five minutes to report a known problem.
- During active work, send a concise report at least every 300 seconds when the
  runtime permits in-flight messages. Include task ID, timestamp, state,
  evidence of progress since the previous report, current operation, next step,
  and any deadline or blocker. Do not include secrets or full logs.
- Separate `last_activity`, `last_report`, and `last_verified_progress`.
  Tool calls, token generation, and heartbeats may update activity but must not
  reset the useful-progress timer unless there is concrete new evidence.
- Use explicit states: `working`, `waiting_tool`, `waiting_human`, `blocked`,
  `completed`, `failed`, and `cancelled`.
- Before a long operation, report the command/session identifier, expected
  duration, bounded timeout, and what observation will establish progress.
  Use asynchronous execution where supported instead of blocking the agent
  indefinitely.
- If no partial-message channel exists, split work into small checkpointed turns
  and return control to Opus between them. This is cooperative supervision, not
  a guaranteed five-minute timer; document the limitation.

#### Runtime watchdog and escalation

The watchdog should use runtime events/timers and task state without invoking
an LLM every few seconds. Opus must not be the sole watchdog for its own run.
Check availability of timers, in-flight messaging, cancellation, and command
timeouts before claiming this policy is enforced.

| Trigger | Required action |
| --- | --- |
| Five minutes without a report during active work | Mark report overdue and request one checkpoint through the runtime, if supported |
| Still no response after a further two minutes | Mark task unresponsive; pause dependent dispatch and escalate to Opus, or the owner if Opus is unresponsive |
| Fifteen minutes without concrete progress | Pause for diagnosis or an explicit revised approach, even if heartbeats continue |
| Command timeout, task deadline, or budget limit reached | Stop further dispatch and use scoped runtime cancellation where supported; preserve evidence and report the outcome |
| Same failure repeated without new evidence | Stop retrying and escalate under the two-correction-cycle limit |

Approved long builds, dependency downloads, or emulator operations can have a
longer progress deadline, set explicitly before execution with a bounded timeout.
Do not repeatedly extend a deadline merely because the operation is still alive.

Waiting for a requested human check is not a stall: record `waiting_human`,
preserve the checkpoint, and suspend active-work timers for that task. Do not
send five-minute reminders to the owner. A tool wait is different: keep its
command deadline active and let the runtime monitor it without model polling.

On suspected hangs:

1. Preserve available task state, changed-file summary, command IDs, recent
   output, and consumed budget.
2. Inspect the specific operation once, or request a concrete checkpoint;
   do not launch another agent to duplicate the same work.
3. Cancel only the identified task/owned command through scoped runtime controls.
   Never use broad process-name termination or discard worktree changes.
4. Confirm the previous writer has stopped before permitting another writer.
   A cancellation request is not confirmation of termination.
5. Resume from preserved evidence with a narrower task or revised plan only after
   the supervisor authorizes it. No unlimited automatic restarts.
6. If cancellation or monitoring is unavailable, report that explicitly and
   request owner intervention; do not claim the hang was resolved.

Before relying on the system, test supervision with a controlled overdue-report
case, a command timeout, a heartbeat-without-progress case, and `waiting_human`.
Validate that deadlines trigger the intended escalation and that waiting for
the owner does not trigger cancellation. Prefer existing runtime facilities;
do not build a custom supervisor service unless necessary and approved.

### Human-in-the-loop testing: choose the cheapest reliable evidence

Actively involve the owner when a short targeted check is faster and more
cost-effective than building UI automation, repeatedly inspecting screenshots,
or debugging device behaviour remotely. Human testing is a normal execution
path, not merely a final approval gate or last resort.

- The planner selects human or automated verification per criterion, considering
  setup effort, repeatability, risk, token/tool cost, and the owner's time.
- Prefer explicit human checks for isolated button behaviour, visual layout,
  pronunciation quality, device voice settings, TalkBack interactions, and
  physical-device lifecycle behaviour when automation adds little value.
- Keep builds, type checks, deterministic learning-logic tests, and frequently
  repeated regression checks automated where practical. A human button check
  does not prove unrelated logic, platform coverage, or build correctness.
- Before creating substantial test infrastructure for a simple interaction,
  ask whether the owner can perform a brief reproducible check instead.
- Opus presents a ready-to-test build or URL, identifies its version/revision,
  and gives short numbered steps with a specific expected result. Request
  pass/fail and the actual observation; request screenshots or logs only when
  they help diagnose a failure.
- Example: "In build X, start a practice round, tap read-aloud, then immediately
  tap 'Richtig gelesen'. Expected: the card advances and previous speech stops.
  Report pass/fail and any speech that continues."
- Use the available structured user-question tool to request the check.
  Batch a few closely related checks to reduce interruptions; do not send a
  large generic testing checklist when one interaction resolves the question.
- Record the owner's reported result, build/device context, and any limitations
  as human evidence. The reviewer can accept it for the matching criterion,
  without demanding duplicate automation solely for formality.
- On failure, route the observation into a bounded fix and targeted retest.
  On unavailable or declined testing, keep the criterion pending and agree on
  an alternative; never infer a pass.
- While awaiting the owner, continue only genuinely independent authorized work.
  Do not poll, repeat the request, or spend tokens simulating the same check.
- Capture useful human feedback in a regression test when repeated failures or
  future risk justify the cost, not automatically for every button check.

### Milestone gates

| Milestone | Required evidence |
| --- | --- |
| A: offline/speech prototype | Local exercise loading, installed/missing voice cases, offline speech and TalkBack device checks |
| B: shared integration | Shared learning logic and website regression checks pass |
| C: Android polish | Back navigation, lifecycle, cancellation, and accessibility checks |
| D: release workflow | Selected revision produces a valid, versioned Android bundle |
| E: store preparation | Reviewed listing/declaration drafts and free-download and in-app-purchase checklist |
| F: handover/release | Update-install test, owner device verification, and explicit publication approval |

Start implementation with Phase A only after resolving its setup decisions and
execution budget. Re-estimate from actual usage before authorizing later phases.
Design approval is not approval to spend the proposed ceiling or publish.

### Safety, concurrency, and accounting

- Permit only one source-writing agent at a time in the shared worktree.
- Parallelize only independent read-only tasks or explicitly isolated approved
  work. Avoid nested agents and speculative investigation.
- Preserve existing worktree changes; stop if conflicting edits are discovered.
- Require owner approval for commits, pushes, paid services, credential changes,
  production publication, and spending-cap increases.
- Do not expose credentials or send private source to unapproved services.
- Pass compact task-specific context and summaries rather than full histories
  or unbounded logs. Retain enough evidence for independent review.
- Record usage by task and model, including failed attempts and subagents.
- Check remaining allowance between calls. Prompt token limits are advisory;
  hard caps require runtime/billing support. Report unavailable metering or
  enforcement explicitly.
- Agent instructions and tool restrictions are not a security sandbox. Control
  production credentials and external permissions outside the prompts as well.

### Planned configuration deliverables

When implementation is authorized, create five project-scoped VS Code custom
agent definitions under `.github/agents/` and a milestone entry prompt under
`.github/prompts/`.

- Orchestrator: the only user-facing agent, pinned to an available Opus model.
- Planner/reviewer: separate Sonnet subagents with read-only tools.
- Implementer/executor: separate Haiku subagents with role-specific tools.
- Only the orchestrator may delegate, and only to these four workers.
- Include the human-checkpoint policy in planning, execution, review, and
  orchestrator instructions; human evidence must be a supported workflow.
- Include the mandatory progress-report contract and validate runtime watchdog,
  timeout, cancellation, and waiting-state behaviour. Report any non-enforceable
  timing guarantees before starting supervised work.
- Validate frontmatter, model availability, tool restrictions, and an actual
  bounded delegation before relying on the configuration.
- If the chosen runtime does not honor a requested restriction or model
  selection, report the limitation and resolve it before implementation.

This document records the approved design, not an installed or running agent
system. Creating these configuration files is a subsequent implementation step.

## 10. Decisions needed before implementation

- Permanent Android package identifier and one-time unlock product price.
- Supported Android/device range.
- Exact Opus/Sonnet/Haiku versions, runtime/provider, real rates or credit rules,
  and approved initial spending cap.
- Merchant account readiness and applicable Play testing gate.
- Owner approval of audience positioning and privacy statements.

Recommended first implementation milestone: Phase A only, followed by a
real-device demonstration and a usage-based budget update.

## References

- [Shared application](static/index.html)
- [Vocabulary attribution and licence](static/words-de-LICENSE.txt)
- [Capacitor build and synchronization workflow](https://capacitorjs.com/docs/basics/workflow)
- [Android TextToSpeech](https://developer.android.com/reference/android/speech/tts/TextToSpeech)
- [Android Voice capabilities](https://developer.android.com/reference/android/speech/tts/Voice)
- [Google Play app pricing](https://support.google.com/googleplay/android-developer/answer/6334373)
- [Google Play target audience](https://support.google.com/googleplay/android-developer/answer/9285070)
- [Google Play personal-account testing requirements](https://support.google.com/googleplay/android-developer/answer/14151465)
