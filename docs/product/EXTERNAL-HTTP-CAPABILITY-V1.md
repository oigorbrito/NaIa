# NaIA External HTTP Capability V1

Status: IMPLEMENTING

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

## Verification

The contract suite uses an in-process HTTP server bound to `127.0.0.1`; it performs real socket I/O without relying on internet access.

Acceptance targets:

- EXT-HTTP-01 configured-origin read executes and is evidenced through NaIA service;
- EXT-HTTP-02 malformed/absolute target fails closed before request;
- EXT-HTTP-03 redirect cannot escape configured origin;
- EXT-HTTP-04 body limit fails closed;
- EXT-HTTP-05 timeout is retryable and never success;
- EXT-HTTP-06 unsupported base scheme/credentials fail at construction;
- EXT-HTTP-07 capability remains opt-in and default registry behavior is unchanged.

The pre-existing product suite remains mandatory.
