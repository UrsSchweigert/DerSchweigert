---
title: Harness Test Optimization Analysis
description: Measured runtime, redundancy, and transitive coverage findings for the offline harness tests
ms.date: 2026-10-27
---

## Recommendation

Keep the safety and real-Git regressions. Evaluate two-worker execution first,
make the Blender CLI probe deterministic, and consolidate selected orchestration
tests only when all distinct assertions survive. Coverage overlap alone is not
evidence that a test is redundant.

The scope is the existing offline harness suite after hardening, excluding the
new GUI module from timing and overlap comparisons. No existing tests were
deleted, no CI defaults were changed, and no production operations were run.
The GUI adds separate HTTP contract tests and was checked interactively in a
browser; those interaction checks are not a committed end-to-end test suite.

## Measurements

Measurements used macOS, uv-managed CPython 3.11.15, temporary stores and Git
remotes, and `HARNESS_LIVE=0`. Live integrations remained skipped.

| Run | Result | Wall Time |
| --- | --- | --- |
| Serial baseline | 488 passed, 10 skipped | 19.58s |
| Serial repeat after parallel run | 488 passed, 10 skipped | 18.42s |
| Two xdist workers | 488 passed, 10 skipped | 9.24s |
| Branch coverage and per-test contexts | 488 passed, 10 skipped | 23.54s |

Two workers took about half the serial wall time in this environment, roughly
a 2.0-2.1x speedup. These are individual runs, not a controlled benchmark or a
guaranteed CI improvement. Coverage instrumentation adds overhead and is not
directly comparable with uninstrumented timing.

The instrumented JUnit report attributes most execution time to three modules:

| Module | Cases | Case Time Including Setup and Teardown |
| --- | --- | --- |
| Runner | 50 | 7.78s |
| Assets | 56 | 5.36s |
| Real Git repository | 7 | 3.05s |
| Integration | 49 | 1.12s |
| Scheduler | 38 | 0.93s |
| Investigator | 82 | 0.83s |

Runner, assets, and real Git account for about 73% of instrumented per-case
time. Optimizing already-cheap model or classification matrices will not
materially change total runtime.

## Redundancy and Transitivity

AST comparison found no exact duplicate bodies among 369 existing test
functions, after ignoring docstrings but preserving names and constants.
This detects literal duplication, not semantic equivalence.

Per-test production-line coverage found:

* 487 test-run contexts touching 3,241 production lines
* 311 contexts with no production line covered exclusively by that test
* 37 groups sharing exactly the same production-line set

These are candidates for semantic review, not a count of removable tests.
The comparison excludes helper modules and setup/teardown contexts. Although
branch coverage was collected, these overlap figures compare line sets, not
per-test branch arcs, input values, assertions, or mutation detection.

For example, 18 failure-code classification cases each reach the same two
lines, and eight missing-field cases each reach the same 640 lines through
fixture setup. The first group protects different classification inputs; the
second mixes a small validation contract with broad orchestration. Equal line
sets do not make those cases interchangeable.

A passing integration test transitively executes many unit-tested paths, but
does not necessarily assert their failure boundaries. Keep invalid-transition,
authorization, stale-evidence, symlink, ownership, and fencing matrices even
when they add no unique line coverage.

Execution-order dependency is a different meaning of transitivity. The passing
two-worker run is evidence against obvious shared-state or ordering problems,
not proof that all tests are independent. Stores and repositories must remain
function-scoped; sharing mutable SQLite or Git fixtures across cases would
weaken isolation.

## Concrete Candidates

### Make the Blender Probe Deterministic

The [CLI probe test](../../tools/harness/tests/test_harness_assets.py#L379)
claims to run without Blender but does not isolate binary discovery, user MCP
configuration, the local addon socket, or `blender --version`. It only asserts
that the response has two keys. This case took 2.597s in the instrumented run;
its cost was not stable across runs.

Stub the probe at the CLI boundary for the JSON/exit-code contract. Keep a
separate explicitly enabled environment smoke test for the real installation,
and focused probe tests for missing binaries, socket refusal, and subprocess
timeout. This improves determinism and avoids a host-dependent default test;
the full observed 2.597s is not a promised saving on every machine.

### Evaluate Two Offline Test Workers

Two workers already passed the full existing offline suite. Repeat serial and
two-worker measurements in CI under equivalent load and compare the median,
variance, and resource use before changing defaults. Pin pytest-xdist in the
development toolchain if adopted. Do not parallelize live integrations merely
because the offline run passes, or assume more workers will be faster.

Keep real Git and subprocess assertions. They protect ancestry, patch identity,
rebase conflicts, fast-forward pushes, current-base checks, and exact revision
checkout that in-memory doubles cannot establish. Their cost is the main
reason parallel execution is more promising than removing small unit tests.

### Narrow the Missing-Field Matrix

The [manual request matrix](../../tools/harness/tests/test_harness_manual.py#L54)
starts an implementer, runs checks, and reaches review eight times to reject
missing fields. The direct
[validator](../../tools/harness/humantasks.py#L65) accepts an issue, details,
reason, and policy without needing a store or scheduler.

Move the eight-field matrix to direct validator tests, and retain an integration
case proving rejection creates no task or issue-state side effect. Keep policy,
stale revision, inconclusive result, failed-result repair, and merge-gate tests
separate. The current matrix costs about 0.170s instrumented in total, so the
benefit is clearer ownership and failure diagnosis, with less than 1% potential
suite-time saving even if all its current cost disappeared.

### Review the Happy-Path Orchestration Cluster

Six cases share an identical 702-line production set, including command
selection, exact-head merging, telemetry, and model-routing assertions. These
are mostly shared execution paths, not duplicated contracts.

The strongest partial overlap is between
[issue-command selection](../../tools/harness/tests/test_harness_integration.py#L277)
and [post-merge rerunning](../../tools/harness/tests/test_harness_integration.py#L289).
The first proves phase-wide commands do not run in place of issue commands.
The second also checks preservation of a two-command sequence. A consolidated
scenario must retain both properties. Their combined instrumented case time
is only 0.047s, so this is optional maintenance work, not a runtime priority.

Keep [exact reviewed-head merging](../../tools/harness/tests/test_harness_integration.py#L331),
[event ordering and fields](../../tools/harness/tests/test_harness_integration.py#L597),
and [model-tier recording](../../tools/harness/tests/test_harness_models.py#L64)
unless their unique assertions are deliberately relocated. Shared scenario
helpers can improve readability, but extracting helpers or parameterizing tests
does not by itself reduce execution count or runtime.

## Adoption Criteria

1. Establish repeated offline timing on the target CI runner before adopting
   two-worker execution. Retain the same pass/skip counts and investigate any
   flaky ordering or environment assumptions.
2. Isolate real environment probes from deterministic contract tests without
   losing explicit smoke coverage.
3. For each consolidation, list preserved assertions and negative boundaries.
   Use a targeted fault injection or mutation to check that the replacement
   still detects the behavior each removed case protected.
4. Keep focused safety regressions and real integrations even when broader
   tests traverse their lines. Do not replace them with a coverage percentage.

No deletion or semantic-equivalence claim is justified by the collected
coverage alone. Mutation testing and repeated CI benchmarking were not run.

## Reproduction

Run from the repository root. The ignored GUI file keeps comparison aligned
with the 498-case baseline; omit that option for the current full suite.
The tooling is isolated with uv and does not change repository dependencies.

```sh
HARNESS_LIVE=0 PYTHONDONTWRITEBYTECODE=1 \
  uv run --no-project --python 3.11 --with pytest \
  python -m pytest -p no:cacheprovider tools/harness/tests \
  --ignore=tools/harness/tests/test_harness_gui.py -q --durations=25

HARNESS_LIVE=0 PYTHONDONTWRITEBYTECODE=1 \
  uv run --no-project --python 3.11 --with pytest --with pytest-xdist \
  python -m pytest -p no:cacheprovider tools/harness/tests \
  --ignore=tools/harness/tests/test_harness_gui.py -n 2 -q

HARNESS_LIVE=0 PYTHONDONTWRITEBYTECODE=1 \
  COVERAGE_FILE=/tmp/harness-analysis.coverage \
  uv run --no-project --python 3.11 --with pytest --with pytest-cov \
  python -m pytest -p no:cacheprovider tools/harness/tests \
  --ignore=tools/harness/tests/test_harness_gui.py \
  --cov=tools/harness --cov-branch --cov-context=test --cov-report= \
  --junitxml=/tmp/harness-analysis.xml -q

COVERAGE_FILE=/tmp/harness-analysis.coverage \
  uv run --no-project --python 3.11 --with coverage \
  python -m coverage json --show-contexts -o /tmp/harness-analysis.json
```

For overlap analysis, associate each production line with contexts ending in
`|run`, discard test/helper paths, then compare the resulting line sets per
context. A line with one context is uniquely covered; matching sets indicate
only matching executed lines. Contexts from subprocesses and setup may require
separate interpretation. Keep measurements and coverage files outside the
repository.
