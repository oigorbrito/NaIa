# Google Calendar live validation

This experiment validates the optional `LIVE_GCAL_READ` gate against the current NaIA runtime/tool-registry architecture.

## Required

- `NAIA_GOOGLE_CALENDAR_ACCESS_TOKEN`: OAuth access token with permission to read the selected calendar.

## Optional

- `NAIA_GOOGLE_CALENDAR_ID` (default: `primary`)
- `NAIA_GOOGLE_CALENDAR_LIVE_FROM` / `NAIA_GOOGLE_CALENDAR_LIVE_TO` (ISO-8601 range; default is the next 24 hours)
- `NAIA_GOOGLE_CALENDAR_TIMEOUT_MS` (default: 5000)
- `NAIA_GOOGLE_CALENDAR_MAX_BYTES` (default: 262144)
- `NAIA_GOOGLE_CALENDAR_LIVE_RECEIPT` (default: `.reproduction/google-calendar-live.json`)
- `NAIA_VALIDATION_COMMIT` (optional explicit commit binding; otherwise `GITHUB_SHA`/`git rev-parse HEAD`)

## Run

```bash
node experiments/google-calendar-live/run.mjs
```

A successful live run exits 0 and writes a receipt containing `status: PASS`, `gate: LIVE_GCAL_READ`, the validation commit, requested range and event count. The receipt does not contain the OAuth token or raw calendar event bodies.

## Security

The OAuth token is held only in the provider closure and Authorization header. The harness scans persisted NaIA objectives, plans and evidence for the token before allowing PASS. Temporary runtime state is deleted unless `NAIA_GOOGLE_CALENDAR_LIVE_KEEP=1` is explicitly set.

## Expected failures

- 401/403: expired token or insufficient OAuth/calendar permission; permanent for that credential.
- 429: rate limited; retryable.
- 5xx: Google/provider failure; retryable.
- timeout: retryable.
- redirects: rejected fail-closed.
- oversized or invalid JSON responses: rejected fail-closed.

A failed validation exits non-zero and writes a redacted `status: FAIL` receipt. A fixture/local-server PASS is test evidence for the harness only; it does **not** close the live Google Calendar gate.
