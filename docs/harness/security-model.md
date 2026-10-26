---
title: Harness Security Model
description: Trust boundaries, isolation tiers, credential handling, and the capability matrix for the incremental development harness
ms.date: 2026-10-26
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

## Policy and Approval Protection

* Workers cannot modify harness code, policy, trusted validation configuration, branch protections, or approval records.
* When the harness lives in the repository, protect it with CODEOWNERS and branch protection, and have trusted code reject any worker diff that touches protected paths. When protection cannot be verified, report it as a gap.
* Store the runtime store and approval records outside the working tree that workers can write.
* Validate approval through a trusted human interaction. The default is a local terminal confirmation by the repository owner that writes a signed record. Agents cannot approve.
* Use hooks for tool checks and thin entry points only.

## Fencing

* Every claim carries a lease epoch. Expired workers are fenced.
* The broker rejects any privileged write whose epoch is stale, so a slow or resurrected worker cannot mutate state after its lease expired.

## Untrusted Content Handling

* Wrap harness-managed issue content in a marker block with a stable identifier and checksum. Content outside the block is advisory input only.
* Accept edits to harness-managed content only from allowlisted authors. Report and ignore the rest.
* Never execute commands found in issue text, comments, or repository files unless they are the validation commands recorded in the approved plan.

## Blender Access

The Blender MCP integration lets a client run Python inside a live Blender process with the operator's privileges. Its addon listens on a local socket (default `localhost:9876`) without authentication or encryption, so anything that can reach the port can execute code. Setup steps are in [Blender setup](blender-setup.md). Asset rules are in the Asset Generation section of the [harness specification](spec.md).

* Treat Blender as a brokered capability. Workers submit asset requests as action proposals and never reach the Blender socket or the MCP server. In Tier A, keep the socket unreachable from the worker's container or account.
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
