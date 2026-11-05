# Buchstabenzeit: Android + iOS paid release

Status: investigation input only; implementation, release and publication are not approved
Date: 2026-11-03
Source: [ANDROID-PLAN.md](../../../sites/lesen/ANDROID-PLAN.md) (approved 2026-10-22) and [IOS-PLAN.md](../../../sites/lesen/IOS-PLAN.md) (proposal, 2026-11-03)

One shared learning app for three channels — website, Android, iOS. `static/` stays the single source; the
packaged apps bundle all exercises, vocabulary, fonts, images and legal notices and work offline on first
launch with no account, backend, or required voice download. Read-aloud uses the device's own speech only.
Both stores are one-time paid.

The executable requirements table below contains product work only. Harness internals and GitHub workflows
are protected from workers: their release requirements are preserved separately below as maintainer-owned
prerequisites, not silently dropped or made writable by a broader allowlist. The iOS plan is proposal-only
until those prerequisites and the owner checklist in IOS-PLAN.md section 5 are satisfied.

## Maintainer-owned release prerequisites (outside worker authorization)

- Original extraction 0.1: add the narrow iOS escalation entries from IOS-PLAN.md section 7.1, with tests.
  Keep Swift/SPM synchronization paths available; never authorize signing secrets in a worker diff.
- Original extraction 0.2: add and test the trusted iOS offline smoke rule from section 7.2, rebuild the
  worker image, and verify a new Tier A attestation. This modifies protected `tools/harness/` files.
- Original extraction 0.3: prove the run-branch CI merge gate fails closed for absent, pending and failed
  checks, and supports a 10-20 minute build. Do not equate base-branch protection with run-branch coverage.
- Original extraction 4.2: maintain the protected Android release workflow, manually triggered or tagged
  independently of website deployment, producing a signed `.aab` with increasing version code.
- Original extraction 5.3: maintain the protected iOS release workflow, with signing from secrets and a
  signed `.ipa` and TestFlight upload. Reconcile the source plan's manual-only release trigger with its
  required per-PR macOS build evidence; a manual-only release run alone does not establish a PR build gate.
  Select a current compatible macOS/Xcode runner rather than assuming `macos-14` supports the required SDK.
- Signing credentials, Apple/Google account setup, store declarations, pricing, physical-device checks,
  review submission and production publication remain owner actions. No approval of a worker plan
  constitutes publication approval.

Keep each unresolved prerequisite visible in the investigation report and release handover. It cannot be
claimed complete by a passing JavaScript test. Do not edit harness policy or workflow protection to make
this product plan executable.

## Execution and evidence boundaries

- Inspect the current repository first; both source plans contain historical statements that may already
  be obsolete. Preserve existing Android/web behaviour and existing bilingual content.
- The Linux checker can verify JavaScript, bundled assets and static native configuration; it has no
  Android SDK/JDK or Xcode. Native build, signing and simulator/device evidence must come from the
  appropriate CI or identified human check, with an exact revision. Record unavailable checks as pending.
- Preserve the source plans' acceptance checks: report CSV golden bytes, lossless migration and restore,
  reminders surviving restart, permission denial without repeated prompts, and no haptics under Reduce
  Motion. Native speech must handle offline/missing-voice cases and interruption/cancellation.
- A physical-device milestone cannot pass on fakes alone. Include revision-bound manual-test gates for
  offline first launch, voice availability, silent switch, reminders, haptics, screen readers and update
  installation. Do not call the release complete while any required gate lacks evidence.
- The source plan's universal layout and German-only listing are provisional choices also listed among
  its open questions. Report these assumptions rather than interpreting them as newly confirmed answers.
- Worker issue IDs must carry a `lesen-`, `android-` or `ios-` prefix to avoid other runs' branch names.
- Use the approved DeepSeek and Copilot/Claude menu, with an independent reviewer, one source writer at
  a time, bounded corrections, and no new paid service. Enable the overseer in the plan policy before
  approval; do not change an approved model menu or budget afterwards.

| ID | Requirement | Phase | Description |
|---|---|---|---|
| **1.1** | **Capacitor 8 upgrade** | P1 | Upgrade `@capacitor/core`, `@capacitor/cli`, `@capacitor/android`, `@capacitor/ios` from 6.2.1 to 8.x; iOS moves to SPM, Android is resynced and rebuilt, Node engine >=20. Website behaviour is unchanged. |
| **1.2** | **Platform adapter contract** | P1 | One interface in `static/` for `speech`, `progress`, `reminders`, `haptics`; the web implementation keeps today's behaviour; adapters are unit-tested with fakes and no UI code calls a plugin directly. |
| **1.3** | **Offline-first bundle** | P1 | Packaged apps load all exercises, vocabulary, fonts, images and legal notices from bundled assets via Capacitor's local origin; no remote application URL, CDN, live-update or essential remote configuration; core practice works in airplane mode. |
| **2.1** | **On-device progress store v3** | P2 | IndexedDB-backed progress store with migration from the `localStorage` v2 schema in `storage.mjs`; v2 data migrates losslessly, unknown versions read as empty, and restore round-trips. |
| **2.2** | **Parent report export** | P2 | On-device summary of attempts, accuracy and practice time; export as CSV through the native filesystem/share sheet with no network. |
| **3.1** | **Native speech** | P3 | Device TTS through the adapter: inspect installed voices for the content locale (`de-DE` first), set rate/pitch, reject network-dependent or missing voices with an accessible explanation, keep the exercise usable without audio, cancel queued speech on card change/exit/backgrounding, and on iOS keep speaking with the silent switch on. |
| **3.2** | **Local practice reminders** | P3 | Scheduled local notifications behind a parental gate, default off; no server or push infrastructure; permission denied must not loop prompts. |
| **3.3** | **Grading haptics** | P3 | Distinct tactile feedback for correct/incorrect grading, suppressed under Reduce Motion. |
| **4.1** | **Android shell** | P4 | Capacitor Android project under `sites/lesen/`: package identity, icons, splash, safe areas; predictable Back behaviour across setup/practice/completion; lifecycle and speech cleanup; bundled version/about, privacy and attribution screens. |
| **4.2** | **Android release handover** | P4 | Document reproducible asset sync, tests, versioning, signing-secret names, internal-track install and upgrade checks under `sites/lesen/`; coordinate with the maintainer-owned workflow above. A valid signed `.aab` remains a required external release gate, not a Linux-checker claim. |
| **5.1** | **iOS shell** | P5 | `cap add ios`, `capacitor.config.json` iOS section, `Info.plist` strings, `CFBundleLocalizations = [de, en]`, icons, universal iPhone+iPad layout; `www/` bundles with no `server.url`; DE/EN switch and language-matched privacy page work in the simulator. |
| **5.2** | **iOS privacy manifest** | P5 | `PrivacyInfo.xcprivacy` declares every required-reason API actually used, matched to on-device-only behaviour; no tracking domains; every reason justified. |
| **5.3** | **iOS release handover** | P5 | Document asset sync, current compatible Xcode/SPM tooling, versioning, signing-secret names, TestFlight installation and device checks under `sites/lesen/`; coordinate with the maintainer-owned workflow above. A signed `.ipa` and TestFlight build remain required external release gates. |
| **5.4** | **iOS review package** | P5 | App Review Notes naming the four native capabilities, an airplane-mode demo script, offline screenshots, and a `RELEASING.md` iOS section; the app is the website's content plus a native spine that the website cannot provide. |
| **6.1** | **Accessibility** | P6 | TalkBack and VoiceOver reading order, keyboard access, visible focus, text scaling, contrast and touch targets; no duplicate or competing announcements from live regions and the read-aloud button; document and card language set correctly. |
| **6.2** | **Paid distribution and listings** | P6 | One-time paid on both stores; transparent that the website stays available separately; App Store listing is German-only for v1 while the app itself is bilingual; store copy distinguishes offline exercises from conditional device speech. |
| **6.3** | **Licences and attribution** | P6 | Bundle and preserve attribution for the CC BY-SA word list and bundled fonts; review every new dependency licence; keep commercial redistribution notices intact. |
