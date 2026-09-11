# Documented quickstart result

CLAIM=the documented local quickstart exercises the product CLI

PROCEDURE=`npm install`, `npm run start:product -- tools`,
`npm run start:product -- pursue "uppercase: hello naia"`, and
`npm run start:product -- history`

INPUT=working tree at `product/mvp-foundation-v1`

EXPECTED_RESULT=installation and all CLI commands exit with code 0; tools are
listed; the uppercase objective completes; history includes the objective

OBSERVED_RESULT=all commands exited with code 0. `tools` listed four tools;
`pursue` returned objective status `COMPLETED`; `history` included the new
objective. `npm install` reported one audited package and zero vulnerabilities.

ARTIFACT=the commands documented in `docs/mvp/README.md`

VERSION=HEAD `add2474abfa93726f8c26fee40cf9266395e1d64` plus the uncommitted
working-tree changes under test

ENVIRONMENT=Windows PowerShell, Node `v24.18.0`, local filesystem, no network
service or credentials used

PASS=local documented quickstart
FAIL=none observed
NOT_EXECUTED=remote provider, external scheduler, independent reproduction
BLOCKED_EXTERNAL=remote experiments lack configured resources
