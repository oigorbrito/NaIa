# NaIA MVP reproduction

This directory documents the locally reproducible MVP slice. It covers the
controlled event and schedule paths; it does not select a durable-execution
chassis or prove distributed exactly-once delivery.

## Requirements

- Node.js 22, 23, or 24 (the package requires `>=22 <25`)
- npm
- Windows PowerShell or an equivalent shell
- No environment variables or external services are required for local tests

Run all commands from the repository root, `C:\Projetos\naia`.

## Install and test

The repository has no third-party runtime dependency. From a clean checkout,
run:

```powershell
npm install
npm test
```

The expected result is a zero exit code and all product tests passing.

## CLI smoke tests

The CLI uses `.naia` as its default data directory. Run these commands from
the repository root:

```powershell
npm run start:product -- tools
npm run start:product -- pursue "uppercase: hello naia"
npm run start:product -- history
```

The controlled trigger API exposes confirmation through the same service
boundary. For a persisted objective that is waiting for confirmation, use:

```powershell
npm run start:product -- confirm <objectiveId>
```

The write path requires the objective ID printed by `pursue`:

```powershell
npm run start:product -- pursue "note release-plan: ship capability"
npm run start:product -- approve <objectiveId> note.write
```

## Reproduction and claims

Follow [REPRODUCE.md](REPRODUCE.md) for the controlled experiments. The
evidence matrix is in [CLAIMS.md](CLAIMS.md), and environment details are in
[ENVIRONMENT.md](ENVIRONMENT.md).

## Limitations

The current artifact does not include a remote provider probe, an external
scheduler registration, a distributed lock, or a production secrets manager.
Those claims remain unexecuted and are not represented as `PASS`.
