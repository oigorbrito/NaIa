# First-Class Provider Capability Packs V1 — Completion Receipt

Date: 2026-09-03

## Scope

Product-only wave stacked above `CONNECTED_CAPABILITIES_AND_INTERACTION_V1`.

## Completed

- provider pack catalog for GitHub, Gmail, and Google Calendar;
- stable capability names, risks, scopes, provider metadata, pack ids and versions;
- inspectable input schemas;
- local schema validation before connector invocation;
- provider-pack-to-gateway adapter;
- gateway manifest compatibility checks for availability, risk drift, and missing scopes;
- focused tests;
- product documentation.

## Non-claims

This wave does not claim that a provider account is connected in a given runtime. It defines and validates the first-class capability contracts that a connector gateway must expose.

This wave does not select a durable execution chassis.

## State

`FIRST_CLASS_PROVIDER_CAPABILITY_PACKS_V1 = COMPLETE`

`RUNTIME_PROVIDER_CONNECTION = ENVIRONMENT_DEPENDENT`

`DURABLE_EXECUTION_ADAPTER = NOT_SELECTED`

`CHASSIS_WINNER = NOT_SELECTED`
