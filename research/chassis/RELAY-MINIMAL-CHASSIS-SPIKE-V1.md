# Relay-inspired minimal chassis spike v1

Issue: #80

## Purpose

This spike tests a deliberately small, provider-neutral runtime boundary inspired by Perplexity WANDR Relay. It is research evidence, not a product migration.

The implementation exercises the NaIA-critical path:

`objective -> plan -> policy/approval -> execution -> event evidence -> persisted state -> resume`

It additionally tests the Relay-derived properties requested by #80:

- durable NaIA run identity;
- provider run identity kept across retries and replaced on explicit full restart;
- bounded retry and restart policies;
- provider-neutral lifecycle/event ledger;
- required-output contracts that fail closed;
- cumulative token/cost accounting across attempts;
- resume without repeating completed steps.

## Boundary

The spike lives only under `research/chassis/harness/`. It does not modify `src/product/`, does not replace current product state, and does not claim that Relay itself is a drop-in NaIA chassis.

## Decision gate

A migration decision still requires measured comparison against the product branch that is ultimately selected/merged, including:

1. equivalent product test behavior;
2. owned LOC and abstraction count;
3. persistence/state-model count;
4. failure/retry/resume semantics;
5. provider portability;
6. dependency/maintenance risk;
7. latency and cost.

Those measurements are now recorded in `RELAY-MINIMAL-CHASSIS-COMPARISON-V1.md`.

Current result:

`RELAY_MINIMAL_CHASSIS = USEFUL_PATTERN_SOURCE / FULL_MIGRATION_NOT_JUSTIFIED_V1`

This is not a permanent selection of the existing chassis. It means only that this specific Relay-inspired replacement does not currently clear the residual-complexity migration gate.

## Test command

```sh
node --test research/chassis/harness/relay-minimal-runtime.test.mjs
```

The file also matches the repository-wide chassis test glob:

```sh
npm run test:chassis
```
