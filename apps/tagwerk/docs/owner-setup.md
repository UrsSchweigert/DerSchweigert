# Owner setup

Steps only the repository owner can do, in order.

1. Copy `apps/tagwerk/docs/ci/tagwerk-workflow.yml` to `.github/workflows/tagwerk.yml` and merge it in a pull request
   of its own. Workers may not edit `.github/workflows/`.
2. Add `test-tagwerk` to the required checks of the `main` branch protection and of the harness run branches
   ruleset. The aggregate job reports on every pull request, also when nothing under `apps/tagwerk` changed, so it
   never blocks unrelated work.
3. Arm the pause after phase P6, so the work stops before the Xcode app skeleton (P7), which needs the owner's Mac
   and Apple developer account.
4. Know the cost of a red check: a red `test-tagwerk` blocks the issue for the owner, because the harness does not
   pass a GitHub check log to a repair attempt. The owner reads the log and fixes or re-plans.
