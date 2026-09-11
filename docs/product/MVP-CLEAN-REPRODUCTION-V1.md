# NaIA MVP Clean Reproduction V1

Status: IMPLEMENTED_PENDING_EXECUTION

## Purpose

Reproduce the exact NaIA commit from a blank checkout instead of relying on an already-used working tree.

The runner:

1. resolves or receives repository URL and exact commit SHA;
2. creates a new directory under the operating-system temp directory;
3. performs a fresh `git clone --no-checkout`;
4. checks out the requested SHA detached;
5. records Node and npm versions;
6. runs `npm ci`;
7. runs `npm test`;
8. runs `git diff --check`;
9. emits a JSON receipt;
10. removes the clean workspace unless `-Keep` is supplied.

## Run

From the NaIA checkout whose exact commit should be reproduced:

```powershell
.\ops\reproduce-mvp.ps1 -ReceiptPath '.reproduction\run-01.json'
```

Repeat independently:

```powershell
.\ops\reproduce-mvp.ps1 -ReceiptPath '.reproduction\run-02.json'
```

The `.reproduction/` directory is evidence output and should not be committed if it contains environment-specific receipts unless explicitly selected as experiment evidence.

## Acceptance

A successful receipt contains:

```text
status = PASS
cleanClone = true
checkedOutCommit == requestedCommit
npmCi = PASS
npmTest = PASS
diffCheck = PASS
```

The MVP clean-reproduction gate requires two independent PASS runs of the same selected commit in the supported Node range.

## External failures

Network/authentication failure during clone is classified separately from a product test failure. A failed clone does not become evidence that the product code failed, but the clean-reproduction gate remains unsatisfied until a complete run reaches PASS.
