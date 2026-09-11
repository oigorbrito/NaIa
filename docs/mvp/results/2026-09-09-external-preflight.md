# External experiment preflight

CLAIM=the current checkout has the resources required to run external MVP
experiments

PROCEDURE=inspect the repository for provider/scheduler harnesses and inspect
environment variable names without printing values

EXPECTED_RESULT=an authorized provider repository, webhook configuration,
credential scope, and external scheduler registration are available

OBSERVED_RESULT=the checkout contains no provider or external scheduler
harness, and no `GITHUB_*`, `NAIA_*`, `PROVIDER_*`, `WEBHOOK_*`, or
`SCHEDULE_*` environment variables are present. One unrelated `RJ_*` variable
is present and was not used.

ARTIFACT=repository search output and this preflight record

VERSION=HEAD `add2474abfa93726f8c26fee40cf9266395e1d64` plus the uncommitted
working-tree changes under test

ENVIRONMENT=Windows PowerShell, local checkout, no credentials or external
service access used

PASS=preflight observation
FAIL=none
NOT_EXECUTED=PROVIDER-E2E-01 and SCHEDULE-E2E-01
BLOCKED_EXTERNAL=required provider repository, webhook, credentials, and
external scheduler registration are not configured in this environment
