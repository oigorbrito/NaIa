# NaIA

NaIA now has two active engineering tracks:

1. **Product track** — executable MVP foundation on `product/mvp-foundation-v1`.
2. **Research track** — chassis qualification and benchmark work, still authoritative for any future chassis-winner claim.

## Product track

Current executable slice:

`objective -> plan -> execution port -> evidence -> persisted state`

The product branch includes local persistence, resume semantics, CLI commands and tests. The execution runtime remains behind a replaceable port; no durable-execution chassis has been selected.

Local commands on the product branch:

```bash
npm test
npm run start:product -- pursue "my objective"
npm run start:product -- show <objectiveId>
npm run start:product -- resume <objectiveId>
```

See [Product Foundation V1](docs/product/PRODUCT-FOUNDATION-V1.md).

## Research track

Research artifacts remain available under `research/chassis/` and `docs/research/`. The formal benchmark is still required before selecting `BENCHMARK_TO_BEAT` or `CHASSIS_WINNER`.

Current decision state:

- `CHASSIS_WINNER = NOT_SELECTED`
- `BENCHMARK_TO_BEAT = NOT_SELECTED`
- `DURABLE_EXECUTION_ADAPTER = NOT_SELECTED`
- `PRODUCT_FOUNDATION_V1 = IMPLEMENTED_NEEDS_RUNTIME_VALIDATION`
