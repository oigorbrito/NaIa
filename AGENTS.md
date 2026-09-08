# Agent Instructions

## Project closure checklist activation

The reusable closure template is `.project/closure/PROJECT-CLOSURE-DOCUMENTATION-TEMPLATE.md`.

Do not instantiate, execute, or populate it merely because it exists. Activate it only when the user explicitly requests project closure, readiness/release closure, a final checklist, a closure audit, or equivalent assessment.

Before use, the responsible agent must read the template and current repository authority, classify it as `VALID_AS_IS`, `NEEDS_ADAPTATION`, or `NOT_APPLICABLE`, identify concrete project facts that justify any adaptation, present those changes explicitly, and only then instantiate a working project-specific checklist.

Do not run tests, create/close issues, merge PRs, or perform implementation solely because the template exists.

## Preserved repository rule

Do not rewrite, normalize, or retroactively alter historical evidence, old results, or preserved artifacts merely to satisfy a current closure checklist. Any closure assessment must be additive and keep historical material bound to its original revision/context.

```text
DOCUMENTED != IMPLEMENTED
IMPLEMENTED != EXECUTED
EXECUTED != ACCEPTED
ISSUE_CLOSED != PROJECT_CLOSED
PR_MERGED != PROJECT_CLOSED
BLOCKED != PASS
NOT_EXECUTED != PASS
HISTORICAL_EVIDENCE != CURRENT_REVALIDATION
```