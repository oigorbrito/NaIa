# CONTROL_PLANE_OPERATIONS_AND_AUTOMATIC_RENEWAL_V1

Status: COMPLETE

## Delivered
- control-plane health snapshot across provider subscriptions
- failed/expired subscription findings
- automatic renewal cycle for subscriptions entering a configurable renewal window
- failed-subscription repair through idempotent `ensure`
- scheduler reconciliation through the existing scheduler bridge
- composite maintenance run
- in-memory and file-backed maintenance journal
- persisted `.naia/control-plane-maintenance.json`
- focused tests for health, renew, repair, scheduler sync, and journal history

## Operational model
An external scheduler/cron invokes `runMaintenance()`. NaIA does not create an embedded timing loop. One run performs:
1. mark subscriptions inside the renewal window
2. renew each marked subscription
3. optionally repair subscriptions in `FAILED`
4. reconcile scheduler registrations
5. calculate a fresh health snapshot
6. persist the maintenance receipt

## Health findings
- `FAILED_SUBSCRIPTION`
- `EXPIRED_SUBSCRIPTION`

## Safety and architecture
Provider credentials remain inside live provider clients and are not persisted in the operations journal. The supervisor coordinates control-plane lifecycle only; it does not execute automation capabilities. Scheduler timing remains outside NaIA Core.

## Exit state
- `CONTROL_PLANE_HEALTH_V1 = COMPLETE`
- `AUTOMATIC_RENEWAL_CYCLE_V1 = COMPLETE`
- `FAILED_SUBSCRIPTION_REPAIR_V1 = COMPLETE`
- `SCHEDULER_RECONCILIATION_OPERATION_V1 = COMPLETE`
- `CONTROL_PLANE_MAINTENANCE_JOURNAL_V1 = COMPLETE`
- `EMBEDDED_MAINTENANCE_LOOP = NOT_IMPLEMENTED`
- `REMOTE_PROVIDER_STATE_PROBE = NOT_IMPLEMENTED`
- `DURABLE_EXECUTION_ADAPTER = NOT_SELECTED`
- `CHASSIS_WINNER = NOT_SELECTED`

## Next wave
`REMOTE_STATE_RECONCILIATION_AND_OPERATIONAL_CLI`
