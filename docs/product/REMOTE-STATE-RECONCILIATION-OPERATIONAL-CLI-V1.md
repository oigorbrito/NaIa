# REMOTE_STATE_RECONCILIATION_AND_OPERATIONAL_CLI_V1

Status: COMPLETE

This wave adds remote/local subscription reconciliation and a dedicated operational CLI for control-plane health, repair, renewal, scheduler sync, maintenance, and history.

## Delivered

- Remote subscription probe contract with `PRESENT`, `MISSING`, `UNKNOWN`, and `ERROR` states.
- GitHub webhook remote probe using `GET /repos/{owner}/{repo}/hooks/{hook_id}`.
- Explicit unverifiable probes for Gmail watches and Google Calendar channels where no equivalent direct read endpoint is exposed by the provider contract used here.
- Drift findings:
  - `MISSING_REMOTE`
  - `ORPHAN_REMOTE`
  - `EXTERNAL_ID_DRIFT`
  - `CALLBACK_DRIFT`
  - `REMOTE_PROBE_ERROR`
  - `REMOTE_UNVERIFIABLE`
- Safe subscription `recreate()` operation for local-active/remote-missing divergence.
- Reconciler `reconcile()` and `repair()` operations.
- Environment-composed operational control plane.
- Dedicated CLI via `npm run control:product -- <command>`.

## Operational CLI

Commands:

```bash
npm run control:product -- health
npm run control:product -- reconcile
npm run control:product -- repair
npm run control:product -- renew
npm run control:product -- sync
npm run control:product -- maintenance
npm run control:product -- maintenance --no-repair
npm run control:product -- history 25
npm run control:product -- subscriptions
```

`health` combines local subscription health with remote reconciliation.

`repair` only repairs actionable drift. `REMOTE_UNVERIFIABLE` and `REMOTE_PROBE_ERROR` are reported but are not automatically repaired.

## Environment

Provider control clients are composed only when their credentials are available:

- `NAIA_GITHUB_TOKEN` or `GITHUB_TOKEN`
- `NAIA_GITHUB_WEBHOOK_SECRET`
- `NAIA_GMAIL_ACCESS_TOKEN`
- `NAIA_CALENDAR_ACCESS_TOKEN`
- `NAIA_CALENDAR_CHANNEL_TOKEN` (optional)

External scheduler binding:

- `NAIA_SCHEDULER_URL`
- `NAIA_SCHEDULER_CALLBACK_URL`
- `NAIA_SCHEDULER_TOKEN` (optional)

State root continues to use `NAIA_DATA_DIR` or `.naia`.

Credentials and webhook/channel secrets are captured by clients and are not written to subscription state, reconciliation reports, or the maintenance journal by this layer.

## Reconciliation behavior

For an active local subscription whose remote object is missing, repair calls `recreate()` rather than `ensure()`. This is required because `ensure()` intentionally returns an already-active local subscription without reprovisioning it.

For a locally stopped subscription that remains present remotely, repair calls `stop()` again to remove the remote orphan while preserving local `STOPPED` state.

Callback or external-id drift is repaired by recreation.

## Provider limitations

GitHub webhook state can be directly inspected by webhook id.

The Gmail watch and Google Calendar channel APIs used by this product do not expose a symmetric direct read operation suitable for a simple probe by the persisted local id. Those providers are therefore reported as `REMOTE_UNVERIFIABLE` in V1 rather than pretending to provide remote certainty.

## Architectural boundary

The CLI does not embed timers, cron evaluation, provider polling loops, or durable execution. It performs one explicit control-plane operation per invocation.

`DURABLE_EXECUTION_ADAPTER = NOT_SELECTED`

`CHASSIS_WINNER = NOT_SELECTED`
