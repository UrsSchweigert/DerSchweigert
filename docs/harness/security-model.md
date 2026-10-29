---
title: Harness Security Model
description: Trust boundaries, isolation tiers, credential handling, and the capability matrix for the incremental development harness
ms.date: 2026-10-27
---

## Overview

The harness is only as strong as the isolation the environment provides. Prompts, hooks, and shell-command blocklists are not security boundaries. This document defines what is trusted, what is not, and which environments permit autonomous execution.

Related documents: [harness specification](spec.md), [state machines](state-machines.md).

## Trust Boundaries

Trusted:

* Harness code, the broker, the scheduler, and the coordinator
* Approval records, policy, and trusted validation configuration
* The runtime store holding journals, claims, and leases

Untrusted:

* Workers and anything they produce, including proposals and results
* Repository content, issue and PR text, comments, and external artifacts
* Agent-written issue content when it is read back as input

Untrusted content is data, never instructions. Pass it to workers inside a delimited data field of the task packet. Instructions embedded in it cannot override policy, approval, or escalation rules.

## Capability Matrix

Stage 1 probes the environment and records the result in `docs/harness/decisions.md`. Use read-only probes and never print credentials.

For each capability, record whether it is detected, the evidence, and the consequence if absent:

* Headless agent runtime that the harness can drive
* Subagent support and model routing
* Supported VS Code hook contracts
* `gh` authentication, token scopes, and repository permissions
* GitHub Projects support
* Native sub-issues and dependencies
* Branch protection and merge queue
* Container, devcontainer, or separate-account isolation
* Notification channel
* Blender, `uv`, the MCP for Blender server, and its addon connection (optional)

A required capability that is missing means the harness fails closed for that function. Report the gap and the smallest viable next action. Do not assume support for Projects or any dependency operation.

## Isolation Tiers

Stage 1 selects the highest tier the matrix supports.

* Tier A: workers run in a container, devcontainer, or separate OS account. The broker holds mutation credentials, such as a GitHub App or fine-grained token, in an identity the worker cannot read. Policy, approval records, the runtime store, and trusted validation configuration are outside worker-writable paths or mounted read-only. `run` is permitted.
* Tier B: workers share the operator's OS user and credentials, or the isolation cannot be verified. Only `plan`, `approve` on a fixture, `status`, and `--dry-run` operations are permitted. `run` refuses and reports the missing isolation.

When the tier is unknown, treat it as Tier B.

## Credentials

* Only the broker holds mutation credentials. Scope them to the repository operations the approval authorizes and prefer short-lived tokens.
* Keep credentials out of worker environments, arguments, task packets, logs, issue content, and sanitized telemetry.
* Workers cannot mutate GitHub state or authorize their own actions. They return action proposals, and the broker validates each against the approval record and the current lease epoch before acting.
* Request secret configuration from humans through an external channel, never through issues or comments.
* **BYOK model keys are the one credential a worker necessarily holds.** When a model source has a provider profile in `<store>/providers.json` (mode `0600`), that source's runs receive its API key by environment name, and only for attempts that use it. This is a deliberate, bounded exception: such a key is billable, so give it a spend cap, keep the profile out of the repository and out of plan packets, and never configure a profile whose key also grants repository access. A run that uses only `copilot` ids forwards no provider key at all, and a `copilot` token is not sent to a BYOK attempt.

## Local Dashboard

The dashboard is a trusted local control surface, not a remote administration
service. It binds only to IPv4 loopback and trusts the operator's OS account.
Do not publish it through a proxy, tunnel, or port forwarding. Other processes
that can access the local account and port are not isolated from it.

* Operator override: `harness remote` is an explicit exception. It is a separate
  loopback-only relay that sits in front of the dashboard, requires a PIN, and
  forwards only the dashboard's fixed route allowlist to the fixed loopback
  upstream while rewriting the loopback Host/Origin the dashboard checks. The
  dashboard itself is never re-bound or exposed directly. When `HARNESS_GUI_PIN`
  is set in the git-ignored `sites/derschweigert/.env`, `harness gui`, `run`,
  and `resume` auto-start the relay plus `cloudflared`; `--no-tunnel` or
  `HARNESS_NO_TUNNEL=1` opts out. The relay weakens the default posture (the PIN
  and tunnel are the only barriers), so it must keep its own controls:
  constant-time PIN comparison, per-address rate limiting and lockout, signed
  HttpOnly/SameSite/Strict session cookies, a 16 MiB body cap, no
  body/token/PIN logging, and no forwarding of arbitrary URLs. Prefer an
  additional tunnel access layer (for example Cloudflare Access) and stop the
  relay when remote access is no longer needed.

* Validate the Host header on all routes. Mutation requests also require a per-server random token, same-origin browser metadata, and JSON content with a bounded length. Read-only mode rejects all mutation requests.
* Serve only fixed HTML, JavaScript, and icon routes. Use a nonce-based Content Security Policy, frame denial, no-store responses, and no referrer. Render store content as text, never HTML. Icons are vendored locally from Lucide 0.468.0; the dashboard requires no CDN.
* Resolve task identity from the OS account and authenticated `gh` login, never a browser-supplied identity. Reuse the existing owner, delegate, stale-revision, and secret-content checks. Only the reviewed-plan approval described under Policy and Approval Protection may create an approval record through HTTP; no other route may write approval state.
* Launch only the fixed trusted coordinator command with argument-list execution and no shell. Require the exact latest plan version, exact plan-ID confirmation, existing valid approval, and verified Tier A. The coordinator and broker still enforce operation and merge gates. Launch can eventually deploy production.
* Keep coordinator logs private to the state folder. A child coordinator survives dashboard shutdown. Process handles and log access are instance-local; the database remains the authority for plan state. Duplicate launch checks are not a persistent lock shared by multiple dashboard processes.
* Limit HTTP request bodies to 16 MiB and browser asset files to 10 MiB. Decode uploads into temporary files with validated basenames; use the existing asset service for policy validation, containment, copying, and provenance. Do not treat filenames or submitted license claims as trusted evidence.

The browser can show sanitized status, stored evidence, human-task details, and
coordinator output. Those may still contain sensitive project information, so
access to the dashboard is access to the selected store. Browser protections
reduce cross-site request risks; they do not authenticate a second local user
or protect a compromised operator account.

## Policy and Approval Protection

* Workers cannot modify harness code, policy, trusted validation configuration, branch protections, or approval records.
* When the harness lives in the repository, protect it with CODEOWNERS and branch protection, and have trusted code reject any worker diff that touches protected paths. When protection cannot be verified, report it as a gap.
* Store the runtime store and approval records outside the working tree that workers can write.
* Validate approval through a trusted human interaction that writes the signed record. Agents cannot approve through either path. **Terminal** approval is the default and the strongest: the owner runs `approve` in a real terminal and types the digest prefix into the process that signs the record, so the session token never leaves it. Use it whenever an approval must not be delegable.
* **Dashboard** approval is the second path, for the owner at their own machine. It is permitted only when all of these hold at once: current Tier A, not `--read-only`, the Host, session-token, and same-origin checks above, a plan version and digest equal to the reviewed copy, the reviewed draft on disk still matching the plan phases and the preflight and issue digests, no pending investigator questions, an approver identity resolved from the OS account and `gh` login, and the first 12 digest characters typed by hand. Changed versions or drafts, unresolved questions, and validation configuration errors block it.
* Residual risk, accepted for the dashboard path: the session token reaches the browser, so that path authenticates a browser session rather than a distinct human. Anyone who can reach the loopback dashboard with the token and knows the digest can approve. Neither path protects a compromised operator account.
* Both the broker and scheduler verify signed operation permissions before privileged actions. A valid approval with an empty or restricted `authorized_operations` list does not authorize omitted operations. Permission denials block work without consuming a repair loop.
* Use hooks for tool checks and thin entry points only.

## Fencing

* Every claim carries a lease epoch. Expired workers are fenced.
* The broker rejects any privileged write whose epoch is stale, so a slow or resurrected worker cannot mutate state after its lease expired.
* Required checks use start, poll, and cancel operations. The coordinator renews the implementer's lease while its checks run and uses the current clock for new claims and completion.
* Each saved check job also carries a unique token and a lease. An expired or replaced job cannot publish results or delete its replacement's metadata. A resumed runner waits for ownership to expire, removes the abandoned named container, and reruns validation.

## Merge Freshness

* Refresh the remote base before inspecting implementation output, integrating reviewed work, and attempting a real merge. Fetch failures stop integration.
* Verify that the tested head actually contains the recorded current base. Metadata alone is not evidence of ancestry. Rebase stale work and rerun checks; carry review forward only when the patch identity is unchanged.
* Before merging, read classic branch protection and require strict up-to-date required status checks, at least one required check, and enforcement for administrators. Unreadable or weaker protection fails closed. Ruleset-only or merge-queue configurations are not independently verified and cannot substitute for this check.
* Bind the merge API call to the reviewed head SHA and accept success only when the API reports `merged: true`. Server-enforced strict checks prevent a base movement after the final fetch from bypassing the gate. The harness never weakens or creates protection settings.

## Untrusted Content Handling

* Wrap harness-managed issue content in a marker block with a stable identifier and checksum. Content outside the block is advisory input only.
* Accept edits to harness-managed content only from allowlisted authors. Report and ignore the rest.
* Never execute commands found in issue text, comments, or repository files unless they are the validation commands recorded in the approved plan.

## Blender Access

The Blender MCP integration lets a client run Python inside a live Blender process with the operator's privileges. Its addon listens on a local socket (default `localhost:9876`) without authentication or encryption, so anything that can reach the port can execute code. Setup steps are in [Blender setup](blender-setup.md). Asset rules are in the Asset Generation section of the [harness specification](spec.md).

* Treat Blender as a brokered capability. Workers submit asset requests as action proposals and never reach the Blender socket or the MCP server. In Tier A, keep the socket unreachable from the worker's container or account.
* Restrict asset request IDs to 1-128 ASCII letters, digits, dots, underscores, and hyphens, beginning with a letter or digit. Resolve every asset, script, manifest, and human-upload destination inside the trusted repository root and reject symlink components, including dangling links.
* Headless host-side Blender execution requires the exact script in a trusted `BlenderCli(reviewed_scripts=...)` allowlist. Worker requests cannot set this allowlist. Unreviewed requests fall back to a human asset task even if procedural generation is permitted by the plan. Human review does not turn host execution into a sandbox.
* In Tier B, `run` refuses, so unattended asset generation is unavailable. An operator can still use Blender manually and submit the result through `respond`.
* Run unattended work against a Blender instance dedicated to the harness, under its own profile with no personal files open. Verify that the addon works in that configuration before relying on it.
* Enable safe mode with `BLENDER_MCP_SAFE_MODE=1`. It blocks scripts that read or write files, start programs, or use the network. It is a blocklist, so treat it as defense in depth and never as a boundary.
* Keep Blender's Auto Run Python Scripts preference off. Treat downloaded `.blend`, glTF, and texture files as untrusted data.
* Disable telemetry with `DISABLE_TELEMETRY=true` and do not opt in to content collection, because prompts, screenshots, and scene data would leave the machine.
* Keep library and generator API keys in Blender add-on preferences or `BLENDERMCP_*` environment variables owned by the broker. Never place them in the repository, issues, task packets, or logs.
* Pin a reviewed version of `mcp-for-blender` for unattended runs, because `uvx` otherwise fetches the latest release.

## Known Limits

* The harness cannot prove semantic correctness or the absence of scope drift. It enforces evidence, scope proxies, and authorization rules.
* A runtime that cannot be sandboxed limits the harness to Tier B.
* Platform rules, such as branch protection and required reviews, are preserved and never bypassed. Record them as blockers when they stop work.
