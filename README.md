# NaIA

NaIA has two active engineering tracks:

1. **Product track** — executable MVP work on `product/mvp-foundation-v1`.
2. **Research track** — chassis qualification and benchmark work, still authoritative for any future chassis-winner claim.

## Product track

Current executable path:

`intent -> actionable plan -> tool selection -> policy -> execution -> evidence -> persisted state/history`

The product branch now includes:

- persisted objectives, plans and append-only evidence;
- resume semantics;
- deterministic intent planning;
- a local tool registry;
- read-only tools that execute directly;
- explicit approval before local write side effects;
- runtime capability registration with planner rules and risk validation;
- CLI history and evidence inspection;
- focused product CI.

Local commands on the product branch:

```bash
npm test
npm run start:product -- tools
npm run start:product -- pursue "uppercase: hello naia"
npm run start:product -- pursue "note release-plan: ship capability"
npm run start:product -- approve <objectiveId> note.write
npm run start:product -- show <objectiveId>
npm run start:product -- resume <objectiveId>
npm run start:product -- history
```

See:

- [Product Foundation V1](docs/product/PRODUCT-FOUNDATION-V1.md)
- [First Useful Capability V1](docs/product/FIRST-USEFUL-CAPABILITY-V1.md)

### Extending capabilities

The service can register a tool and its intent rule without modifying the default
planner. The registered action must declare one of `READ_ONLY`, `LOCAL_WRITE`,
`EXTERNAL_WRITE` or `SENSITIVE`; policy compares that declaration with the tool's
registered risk and fails closed on a mismatch.

```js
const planner = createIntentPlanner();
const ports = createInMemoryPorts({ planner });
const naia = createNaiaService(ports);

naia.registerCapability({
  name: 'text.reverse',
  tool: {
    risk: 'READ_ONLY',
    capability: 'text.transform',
    async run(input) {
      return { text: [...String(input.text)].reverse().join('') };
    },
  },
  rule: {
    match: ({ title }) => title.startsWith('reverse: '),
    action: ({ title }) => ({
      tool: 'text.reverse',
      input: { text: title.slice(9) },
      risk: 'READ_ONLY',
      requiresApproval: false,
    }),
  },
});
```

## Research track

Research artifacts remain available under `research/chassis/` and `docs/research/`. The formal benchmark is still required before selecting `BENCHMARK_TO_BEAT` or `CHASSIS_WINNER`.

Current decision state:

- `PRODUCT_FOUNDATION_V1 = COMPLETE`
- `FIRST_USEFUL_CAPABILITY_V1 = COMPLETE`
- `CHASSIS_WINNER = NOT_SELECTED`
- `BENCHMARK_TO_BEAT = NOT_SELECTED`
- `DURABLE_EXECUTION_ADAPTER = NOT_SELECTED`
