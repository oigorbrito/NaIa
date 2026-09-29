# Agent Instructions

## Evidence-first research and implementation gate

Before starting new architecture research, candidate evaluation, or implementation work, read `docs/research/EVIDENCE-FIRST-ENGINEERING.md`.

Required behavior:

1. Search existing repository research/evidence before creating a new test.
2. Prefer peer-reviewed benchmarks, reproducible upstream benchmarks, exact source/tests, and official documentation over opinion or popularity.
3. Use Context7 for current software/library documentation when appropriate; do not treat it as primary evidence for academic/clinical benchmark claims.
4. Do not repeat an external benchmark locally unless a material Nayara-specific delta could change the decision.
5. Record the external protocol/task, population, metric, limitations, applicability, and exact local delta.
6. Distinguish architecture/chassis qualification from feature breadth.
7. Distinguish benchmark signal from local proof and implementation from qualification.
8. For therapeutic systems, preserve subgroup behavior. Aggregate averages must not hide failures for reserved/evasive, upset/resistant, verbose, tangential, or approval-seeking interaction styles.
9. Treat adaptive information-gap questioning as a mechanism that may be reused from evidence such as AgentMental; do not convert an assessment mechanism into an unsupported diagnostic claim.
10. Do not merge personal-assistant and therapeutic authority boundaries merely for code reuse. Cross-domain communication must be explicit, minimal, and auditable.

```text
BENCHMARK_SIGNAL != LOCAL_PROOF
EXTERNAL_SUCCESS != LOCAL_COMPATIBILITY
IMPLEMENTED != QUALIFIED
QUALIFIED != PROMOTED
POPULAR != ARCHITECTURALLY_FIT
```

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