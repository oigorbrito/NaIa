# NaIA — Live credentials and validation runbook

This document explains how to obtain credentials for the live-provider adapters already present in NaIA and how to make them available to the runtime without committing secrets.

## Security rule

Never paste API keys, OAuth access tokens, client secrets, Belvo secrets, Slack tokens, WhatsApp tokens, or other credentials into:
- GitHub issues or pull requests;
- committed files;
- chat messages;
- test fixtures;
- screenshots.

Use a local environment file excluded from Git, a deployment secret manager, or GitHub Actions secrets. The repository keeps only variable names in `.env.example`.

When asking ChatGPT to continue validation, say only which variables are configured and which environment they belong to. Example:

> Sandbox ready: BELVO_SECRET_ID, BELVO_SECRET_PASSWORD and BELVO_LINK_ID are configured locally.

Do not include the values.

---

## 1. OpenAI

### What NaIA needs

`OPENAI_API_KEY`

### How to create it

1. Open the OpenAI API platform.
2. Create or choose a dedicated project for NaIA.
3. In project settings, open **API Keys**.
4. Create a new secret key or, preferably for a deployed service, create a project service account and its key.
5. Restrict the key permissions and project model access to what NaIA actually needs.
6. Store the key immediately; the complete secret is only shown when created.

### How to provide access to NaIA

Set:

`OPENAI_API_KEY=<secret>`

Use a local secret store or deployment secret manager. Do not commit it.

### What to tell ChatGPT

Say:

> OPENAI_API_KEY configured in the NaIA runtime.

Do not send the key itself.

---

## 2. Anthropic / Claude

### What NaIA needs

`ANTHROPIC_API_KEY`

### Setup

1. Create or use an Anthropic Console workspace intended for NaIA.
2. Enable API billing/credits as required by the workspace.
3. Create a dedicated API key for NaIA.
4. Store it in your secret manager.

### Runtime

`ANTHROPIC_API_KEY=<secret>`

### What to tell ChatGPT

> ANTHROPIC_API_KEY configured.

---

## 3. Gemini

### What NaIA needs

`GEMINI_API_KEY`

### Setup

1. Open Google AI Studio.
2. Use a dedicated Google Cloud project for NaIA.
3. Open **API Keys**.
4. Create a new Gemini key.
5. In 2026, prefer the newer authorization-key model rather than an unrestricted legacy standard key.
6. Restrict the key to the Gemini API and configure billing/quota if required.

### Runtime

`GEMINI_API_KEY=<secret>`

### Important

The current NaIA adapter uses `generateContent`, which remains supported but Google now recommends the newer Interactions API for new development. Live validation should therefore include a follow-up decision on migrating the Gemini edge adapter; this must not affect the provider-neutral NaIA core.

---

## 4. DeepSeek

### What NaIA needs

`DEEPSEEK_API_KEY`

### Setup

1. Open the DeepSeek API developer console.
2. Create an API key.
3. Add API credit/billing if required.
4. Store it as a server-side secret.

### Runtime

`DEEPSEEK_API_KEY=<secret>`

NaIA keeps the exact model ID in configuration rather than hard-coding one vendor model permanently.

---

# Google OAuth providers

Gmail, Drive, Calendar, and Google Photos use OAuth access tokens rather than a permanent API key.

For initial live validation, NaIA accepts access tokens directly. For production, the next step is to wire the full OAuth authorization-code/refresh-token lifecycle behind a secure credential store.

## Shared Google Cloud setup

1. Open Google Cloud Console.
2. Create or select a dedicated NaIA project.
3. Configure the OAuth consent screen / Google Auth Platform branding.
4. Add yourself as a test user while the app is in testing.
5. Enable the APIs you want to validate:
   - Gmail API;
   - Google Drive API;
   - Google Calendar API;
   - Google Photos Picker API;
   - Google Photos Library API when using app-created albums.
6. Create an OAuth 2.0 client appropriate to the validation environment.
7. Authorize only the minimum scopes required.
8. Exchange the authorization result for an access token.
9. Inject that access token into the corresponding variable below.

For development, keep separate tokens per capability so least-privilege validation is easy to audit.

---

## 5. Gmail — #31

### Runtime variable

`GMAIL_ACCESS_TOKEN`

### Minimum scopes for current NaIA behavior

NaIA currently needs search/read and send. Use the narrow Gmail scopes that cover the exact test. Typical combination:

- `https://www.googleapis.com/auth/gmail.readonly` for message read/search;
- `https://www.googleapis.com/auth/gmail.send` for approved send.

Do not request full `https://mail.google.com/` merely for convenience.

### Live validation checklist

- search a known mailbox query;
- read one known message;
- prepare an outbound email through NaIA;
- confirm it waits for NaIA approval;
- approve once;
- verify exactly one send;
- verify token does not appear in persisted state/evidence.

---

## 6. Google Drive — #40

### Runtime variable

`GOOGLE_DRIVE_ACCESS_TOKEN`

### Scopes

Current connector intentionally accepts read-only scopes:

- `https://www.googleapis.com/auth/drive.readonly`;
- optionally `https://www.googleapis.com/auth/drive.metadata.readonly`.

Do not grant full `drive` scope for the current feature.

### Live validation checklist

- connect using read-only scope;
- search a file by name/content;
- read a supported text/Google Workspace file;
- verify unsupported binary formats fail explicitly;
- revoke the connection and verify calls stop;
- verify raw OAuth token is never persisted.

---

## 7. Google Calendar — #30

### Runtime variable

`GOOGLE_CALENDAR_ACCESS_TOKEN`

### Scope for the live-read gate

For the current LIVE_GCAL_READ validation use:

`https://www.googleapis.com/auth/calendar.readonly`

or, if validating event-level reads only:

`https://www.googleapis.com/auth/calendar.events.readonly`

Do not broaden to write scopes for the read validation gate.

### Expected repository output

Run the existing live Calendar harness and produce:

`.reproduction/google-calendar-live.json`

with:
- `status=PASS`;
- `gate=LIVE_GCAL_READ`;
- current commit binding;
- no OAuth token in the receipt.

---

## 8. Google Photos — #67

### Runtime variable

`GOOGLE_PHOTOS_ACCESS_TOKEN`

### Picker behavior

The Picker flow is explicitly user-driven. NaIA creates a Picker session and receives a `pickerUri`. The user opens that URI, selects media, then NaIA resumes the persisted `WAITING_USER` session.

The runtime must not claim it can silently enumerate the user's complete Photos library.

### Library scope for app-created album creation

Creating a Google Photos album requires:

`https://www.googleapis.com/auth/photoslibrary.appendonly`

Editing metadata of app-created content uses:

`https://www.googleapis.com/auth/photoslibrary.edit.appcreateddata`

Use only what the exact validation requires.

### Live validation checklist

- create Picker session;
- open `pickerUri`;
- choose one or more test images;
- resume session;
- confirm provenance and provider item IDs;
- confirm temporary media URL handling;
- create one app-owned test album only after normal NaIA external-write approval;
- verify there is no full-library scan claim.

---

# Messaging providers

## 9. Slack — #45

### Runtime variable

`SLACK_ACCESS_TOKEN`

### Recommended setup

1. Create a dedicated Slack app.
2. Open **OAuth & Permissions**.
3. Configure the HTTPS redirect URL if using OAuth.
4. Request only scopes required by the test.
5. Install/reinstall the app into the test workspace.
6. Store the resulting access token securely.

Current adapter uses:
- `search.messages`;
- `conversations.history`;
- `chat.postMessage`.

For classic workspace search, `search:read` is a user-token scope. Slack now marks that scope as legacy and offers more granular real-time-search scopes, so validate whether NaIA should migrate search before production.

Conversation history requires the appropriate conversation-type scope, e.g.:
- `channels:history`;
- `groups:history`;
- `im:history`;
- `mpim:history`.

Outbound messages use:
- `chat:write`.

### Live validation checklist

- search one known term;
- read one known channel/conversation the authorized identity can access;
- prepare reply;
- confirm no send before NaIA approval;
- approve once;
- verify one `chat.postMessage`;
- revoke app/token and verify subsequent calls fail.

---

## 10. WhatsApp Cloud API — #41

### Runtime variables

`WHATSAPP_ACCESS_TOKEN`
`WHATSAPP_PHONE_NUMBER_ID`
`WHATSAPP_VERIFY_TOKEN` — when webhook verification endpoint is wired.

### Meta setup

Use a Meta developer app with WhatsApp Business / Cloud API enabled.

You need:
- an access token;
- the WhatsApp **Phone Number ID** used by the Graph `/{phone-number-id}/messages` endpoint;
- a public HTTPS webhook callback when validating inbound messages;
- a webhook verification token chosen by you and stored as a secret.

### Important architectural rule

WhatsApp inbound history is not modeled as a fake history-search API. NaIA ingests webhook events and searches/reads the events it has legitimately received.

### Live validation checklist

- configure webhook callback;
- verify webhook subscription;
- send a test WhatsApp message to the configured business number;
- verify NaIA ingests it exactly once even if webhook delivery repeats;
- prepare reply;
- confirm no outbound send before approval;
- approve once;
- verify one Graph API outbound message.

---

# Brazilian Open Finance

## 11. Belvo — #75

### Start with Sandbox

Belvo explicitly recommends using Sandbox first. Sandbox provides dummy banking data and Brazil Banking Aggregation support.

### Runtime variables

`BELVO_SECRET_ID`
`BELVO_SECRET_PASSWORD`
`BELVO_LINK_ID`
`BELVO_API_BASE_URL=https://sandbox.belvo.com`

### Generate credentials

1. Create a Belvo account.
2. Open the Sandbox environment.
3. Go to **Developer Tools → API Keys**.
4. Click **Generate API Keys**.
5. Store both values:
   - `secretId`;
   - `secretPassword`.
6. The `secretPassword` is shown only once. If lost, rotate/reset the API keys.
7. Keep production credentials completely separate from sandbox credentials.

### Create a test user connection

Belvo models an authorized financial connection as a **Link**. For Open Finance production/user consent, Belvo recommends its hosted widget/consent flow.

For first NaIA validation:
- use Sandbox;
- use the Banking Brazil sandbox institution such as `ofmockbank_br_retail`;
- create a sandbox link using Belvo's test flow;
- copy only its non-secret Link ID into `BELVO_LINK_ID`.

The Link ID is an identifier, not the API password, but still treat it as operational configuration.

### Live/sandbox validation checklist

- import account(s);
- import balance(s);
- import transactions;
- rerun the same import and verify no duplicate logical transaction;
- test pending/posted refresh if the sandbox dataset allows it;
- query spending/balances through NaIA;
- revoke/expire test consent and verify explicit failure;
- confirm `secretId` and `secretPassword` never appear in finance state/evidence.

Do not enable Belvo payment initiation for #75. NaIA's finance issue is read-side only.

---

# How to give ChatGPT access safely

## Connected apps inside ChatGPT

For Gmail, Google Calendar and Google Drive, you can use the already-connected ChatGPT plugins for work performed directly in those accounts. That is separate from NaIA's own production credentials.

For example, you can tell ChatGPT:

> Use my connected Google Drive to inspect the validation document.

This does not automatically give the NaIA repository/runtime an OAuth token.

## Credentials for NaIA runtime

ChatGPT should not receive the raw secret in the conversation.

Instead:

1. create the credential at the provider;
2. put it in your local/deployment secret environment using the variable name from `.env.example`;
3. tell ChatGPT only:
   - which variables exist;
   - sandbox/test/production;
   - whether OAuth consent was completed;
   - any non-secret IDs needed for configuration.

Example:

> Belvo Sandbox configured: BELVO_SECRET_ID, BELVO_SECRET_PASSWORD and BELVO_LINK_ID are set. You can continue #75 validation.

or:

> Google test OAuth is complete; GMAIL_ACCESS_TOKEN and GOOGLE_DRIVE_ACCESS_TOKEN are set locally.

At that point ChatGPT can continue the repository work, validation harnesses, scripts and checklists without the secret ever appearing in GitHub or chat.

## If a secret is accidentally pasted

Rotate/revoke it immediately at the provider, create a replacement, and remove the exposed value from every persisted location where possible. Never keep using a key that has appeared in a public repository or chat/log intended for long-term retention.
