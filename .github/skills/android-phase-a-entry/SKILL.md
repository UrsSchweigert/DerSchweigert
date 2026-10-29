---
name: android-phase-a-entry
description: "Milestone entry prompt for Buchstabenzeit Android Phase A: self-contained Capacitor Android offline feasibility and optional offline device TTS, preserving the website. Runs as the Android orchestrator."
disable-model-invocation: true
argument-hint: "Optional: device/model/billing constraints to apply before starting Phase A"
---
Commence **Phase A only** of [ANDROID-PLAN.md](../../sites/lesen/ANDROID-PLAN.md):
self-contained Capacitor Android feasibility and optional offline native device
text-to-speech, while preserving the existing website. Do not start Phase B+.

## Preconditions to confirm first
- Shared source is [sites/lesen/static/](../../sites/lesen/static) (~1.8 MB,
  `index.html` + `words-de.json`, 4,365 entries). No build system exists yet.
- The plan file `sites/lesen/ANDROID-PLAN.md` is untracked in this shared
  worktree; read it from disk. Preserve all existing worktree changes.
- Resolve the blocking section-10 decisions with the owner before spending
  materially: exact Opus/Sonnet/Haiku versions among those available, the actual
  billing/metering cap (design approval is NOT ceiling approval), permanent
  package identifier, minimum Android version, and the test device.

## Phase A scope (plan §4.A)
- Confirm package identifier, minimum Android version, and supported devices.
- Stand up a minimal local-asset Capacitor Android project under `sites/lesen/`
  with a locked dependency manifest and a reproducible asset-copy command.
- Verify relative assets and `words-de.json` load with no connectivity.
- Prove native device speech for `de-DE`, missing-suitable-voice handling (clear
  accessible explanation; practice stays fully usable), offline-only voice policy
  (no silent network fallback), speech cancellation on card change/exit/background,
  and TalkBack coexistence.
- Stop and resolve incompatible speech/plugin behaviour before expanding scope.

## Hard constraints
- No bundled recordings, speech model, or speech engine; no required voice download.
- All reading functionality must work offline; speech gracefully reports missing
  suitable local voices.
- No remote application URL, live-update, CDN, or essential remote config.
- No commits, pushes, credential changes, recurring paid services, or publication
  without explicit owner approval.

## Execution contract
- Work through the planner → implementer → executor → reviewer loop; only you
  (orchestrator) delegate, and only to the four `android-*` workers.
- One source-writing agent at a time in the shared worktree.
- Enforce the bounded task packet, five-minute progress contract, no-progress
  escalation, and two-correction-cycle limit. Disclose honestly which supervision
  guarantees are cooperative-only when runtime timers/cancellation/in-flight
  messaging are unavailable; never claim hard enforcement without support.
- Prefer cheap targeted owner device/button checks over building automation; use
  the structured user-question tool with short numbered steps and expected results.
- Complete bounded implementation and verification where possible; mark manual
  device checks pending ("awaiting device verification") until the owner reports.
- After Phase A, report actual billed usage per model and re-estimate before any
  later phase. Keep the handover concise and evidence-based.
