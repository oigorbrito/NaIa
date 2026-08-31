# Candidate Setup Contract

Status: SPECIFIED

This contract exists to keep environment/bootstrap failures separate from candidate behavior.

A candidate may enter runtime execution only when all of the following are true:

1. Adapter source exists and is hashable.
2. Harness source exists and is hashable.
3. Candidate package manifest exists.
4. Every package/version declared by `adapter-capabilities.v1.json` is pinned exactly in that manifest.
5. Every required package is actually installed and its resolved `package.json` reports exactly the expected version.
6. Every required environment variable name is present. Secret values are never recorded; only required names and missing names are stored.
7. Setup cleanup/isolation has been verified before the run.

If any precondition fails, setup returns `BLOCKED_SETUP`. The candidate runtime must not be called and the experiment cannot be classified PASS or FAIL.

The setup record must preserve:

- candidate version and source reference;
- adapter SHA-256;
- harness SHA-256;
- package manifest SHA-256;
- expected, declared, and installed dependency versions;
- installed package metadata paths;
- execution mode and worker-authority boundary;
- required environment variable names and which names were missing;
- blocker identifiers.

A declaration in `package.json` is not evidence that a dependency was installed. A source audit is not runtime execution evidence.
