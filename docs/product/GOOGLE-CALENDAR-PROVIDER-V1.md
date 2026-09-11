# NaIA Google Calendar Provider V1

Status: IMPLEMENTING

## Purpose

Bind the provider-neutral NaIA calendar contract to Google Calendar API v3 without changing NaIA policy, approval, evidence, or persistence semantics.

## Current API basis

The provider follows the current Google Calendar API v3 behavior verified against Google documentation in September 2026:

- events.list with `timeMin`, `timeMax`, `singleEvents=true`, and `orderBy=startTime`;
- events.insert for event creation;
- events.patch for partial event updates, preferred over full update where only selected fields change;
- `primary` is supported as the signed-in user's primary calendar identifier.

## Runtime configuration

```text
NAIA_GOOGLE_CALENDAR_ACCESS_TOKEN   required to enable provider
NAIA_GOOGLE_CALENDAR_ID             optional, default primary
NAIA_GOOGLE_CALENDAR_TIMEOUT_MS     optional, default 5000
NAIA_GOOGLE_CALENDAR_MAX_BYTES      optional, default 262144
NAIA_GOOGLE_CALENDAR_API_BASE_URL   optional test/override, default https://www.googleapis.com
```

The access token is provider construction state only. It must never be copied into objective, plan, action input, capability metadata, or evidence.

## Mapping

NaIA `calendar.list({from,to})` -> Google `GET /calendar/v3/calendars/{calendarId}/events`.

NaIA `calendar.create({start,end,title})` -> Google `POST /calendar/v3/calendars/{calendarId}/events` with `summary`, `start.dateTime`, `end.dateTime`.

NaIA `calendar.update({eventId,start,end,title})` -> Google `PATCH /calendar/v3/calendars/{calendarId}/events/{eventId}` with the same mutable fields.

## Safety

- bearer token only in Authorization header;
- fixed API origin at provider construction;
- no redirects;
- bounded response body;
- timeout abort;
- 5xx/429 retryable;
- other 4xx permanent;
- generic calendar HTTP provider and Google provider cannot be enabled simultaneously.

## Gates

- GCAL-01 list request shape and normalization.
- GCAL-02 create request shape.
- GCAL-03 patch request shape and encoded event identity.
- GCAL-04 token is required and never exposed by provider output.
- GCAL-05 429/5xx retryable; other 4xx permanent.
- GCAL-06 timeout never becomes success.
- GCAL-07 runtime composition registers Google-backed calendar capabilities.
- GCAL-08 ambiguous dual calendar provider configuration fails closed.
