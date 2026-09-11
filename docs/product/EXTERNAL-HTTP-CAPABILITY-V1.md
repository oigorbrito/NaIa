# NaIA External HTTP Capability V1

Status: IMPLEMENTED / PENDING_LOCAL_REPRO

## Goal

Exercise the extensible capability layer with real external I/O while preserving NaIA authority, evidence, and fail-closed semantics.

This block does not bind NaIA to OpenManus or to a SaaS provider. It introduces a narrow read-only HTTP primitive that future provider-specific capabilities (calendar, mail, messaging, search) can compose behind explicit configuration.

## Contract

The adapter is constructed with a fixed `baseUrl` and a configurable tool name. An action carries only a relative path:

```json
{
  "tool": "http.read",
  "input": { "path": "/resource" }
}
```

This is intentionally narrower than arbitrary URL fetching. Provider origin is configuration, not user input.

## Security invariants

- `baseUrl` must use `http:` or `https:` and cannot contain embedded credentials;
- action input must be a relative absolute-path beginning with `/` and cannot begin with `//`;
- every request remains on the configured origin;
- redirects are handled manually and every redirect target must remain on the same origin;
- response body is capped by `maxBytes` while streaming;
- request is aborted after `timeoutMs`;
- GET is the only method;
- no ambient credentials or headers are attached by default;
- unsupported/malformed targets fail closed;
- timeouts and 5xx/network failures are retryable; policy/configuration failures are non-retryable.

## Capability factory

`createHttpReadCapability({ prefix, tool })` is opt-in. Example:

```text
provider-read /resource
```

maps to the configured tool with `READ_ONLY` risk and no approval ceremony.

The capability is not added to the default NaIA capability registry. A product/channel must register it explicitly together with its adapter configuration.

## CLI runtime configuration

The standard product CLI keeps this capability disabled unless `NAIA_HTTP_BASE_URL` is set.

Supported environment variables:

- `NAIA_HTTP_BASE_URL` — provider origin; enables the capability;
- `NAIA_HTTP_PREFIX` — user intent prefix, default `provider-read`;
- `NAIA_HTTP_TOOL` — execution tool name, default `http.read`;
- `NAIA_HTTP_TIMEOUT_MS` — positive integer, default `5000`;
- `NAIA_HTTP_MAX_BYTES` — positive integer, default `262144`.

Example:

```powershell
$env:NAIA_HTTP_BASE_URL = "http://127.0.0.1:8787"
$env:NAIA_HTTP_PREFIX = "provider-read"
npm run start:product -- capabilities
npm run start:product -- pursue "provider-read /profile"
```

`baseUrl` remains runtime configuration and is not copied into the objective plan. The persisted plan carries only the relative path.

## Verification

The contract suite uses an in-process HTTP server bound to `127.0.0.1`; it performs real socket I/O without relying on internet access.

Acceptance targets:

- EXT-HTTP-01 configured-origin read executes and is evidenced through NaIA service;
- EXT-HTTP-02 malformed/absolute target fails closed before request;
- EXT-HTTP-03 redirect cannot escape configured origin;
- EXT-HTTP-04 body limit fails closed;
- EXT-HTTP-05 timeout is retryable and never success;
- EXT-HTTP-06 unsupported base scheme/credentials fail at construction;
- EXT-HTTP-07 capability remains opt-in and default registry behavior is unchanged;
- EXT-CONFIG-01 capability stays disabled when runtime configuration is absent;
- EXT-CONFIG-02 explicit environment configuration wires capability and adapter;
- EXT-CONFIG-03 invalid numeric configuration fails closed at startup.

Expected aggregate suite on this branch:

```text
18 baseline tests
+ 7 capability-layer tests
+ 7 HTTP adapter tests
+ 3 runtime-configuration tests
= 35 tests
```

Acceptance target: `tests 35 / pass 35 / fail 0`.

Remote GitHub Actions remains `BLOCKED_EXTERNAL / NOT_VALIDLY_MEASURED` while repository-wide workflow failures persist. Local reproduction is required before declaring this block PASS.
