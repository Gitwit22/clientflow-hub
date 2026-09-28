# ClientFlow ↔ n8n: outbound email connection

The complete reference for how ClientFlow sends email through n8n: what ClientFlow sends, what the n8n
workflow accepts and requires, how the two line up, and what is still open.

- **ClientFlow side** is taken from `clientflow-api` source (`src/integrations/n8n/`, the contracts, forms
  and clients modules).
- **n8n side** is taken from an audit of the saved workflow **CLIENTFLOW - Send Form Email**
  (`guaPPO3kms02Vs1J`, 31 nodes): the actual node parameters, expressions and Code nodes. The workflow
  itself is owned and edited in n8n, not in this repo.

Related, narrower docs: `N8N_EVENTS.md` (event summary), `N8N_WELCOME_EMAIL.md` (welcome wording and
attachment), `N8N_CONTRACT_COPY.md` (signed-copy event).

**2026-09-28 baseline:** The n8n audit below predates the rollback and is historical, not a
description of the current live workflow. The frozen `contract.copy` request and agreed dedicated
branch are documented in [N8N_CONTRACT_COPY.md](N8N_CONTRACT_COPY.md). For this event, that document
supersedes the older normalization, URL fallback, and body-validation details below. Other
ClientFlow event payloads are unchanged by this alignment.

---

## 1. Overview

```
ClientFlow (clientflow-api)
   │  POST <webhook>   one request per email, synchronous
   │  headers: x-clientflow-secret, Authorization: Bearer, Idempotency-Key
   ▼
n8n "CLIENTFLOW - Send Form Email"
   auth → normalize → validate → route by event → validate content → brand → (download attachment) → Gmail
   │  writes clientflow_email_log (idempotency + audit)
   ▼
JSON receipt  { success, eventId, sentAt, … }   ← ClientFlow records SENT / FAILED
```

**Who owns what**

| ClientFlow | n8n |
|---|---|
| Client-facing wording where it has authored it (welcome subject/body, automation emails) | Auth, routing, validation |
| Which email to send, to whom, and when | Branding (header, footer), layout |
| Attachment identity (URL, filename, type) | Downloading the attachment, Gmail delivery |
| Attempt identity (`eventId`), audit records, retries | Idempotency log and the synchronous receipt |

---

## 2. Transport (ClientFlow → n8n)

### Configuration (ClientFlow environment)

The first name listed in each row wins; the others are accepted aliases.

| Setting | Variables (in priority order) |
|---|---|
| Enabled | `N8N_ENABLED`, `N8N_FORM_EMAIL_ENABLED`, `CLIENTFLOW_N8N_FORM_EMAIL_ENABLED` (any `true`) |
| Webhook URL | `N8N_EMAIL_WEBHOOK_URL`, `CLIENTFLOW_N8N_FORM_EMAIL_WEBHOOK_URL`, `N8N_FORM_EMAIL_WEBHOOK_URL` |
| Shared secret | `CLIENTFLOW_N8N_SECRET`, `CLIENTFLOW_N8N_CLIENTFLOW_SECRET`, `N8N_CLIENTFLOW_SECRET` |
| Bearer token | `N8N_EMAIL_BEARER_TOKEN`, `CLIENTFLOW_N8N_FORM_EMAIL_BEARER_TOKEN`, `N8N_FORM_EMAIL_BEARER_TOKEN` (a leading `Bearer ` is stripped) |
| Organization override | `N8N_ORGANIZATION_ID` (replaces `organizationId` in every outbound payload when set) |
| Timeout | `N8N_FORM_EMAIL_TIMEOUT_MS`, else `N8N_TIMEOUT_MS` (**default 15 000 ms**) |

Availability is `ready` only when enabled **and** a webhook URL **and** a secret are present; otherwise
sends are recorded as `disabled` / `not_configured` and nothing is sent. `GET /api/v1/admin/cf/system/n8n-status`
shows which variables resolve (no secrets).

### Request

`POST <webhook URL>` with:

| Header | Value |
|---|---|
| `Content-Type` | `application/json` |
| `x-clientflow-secret` | the shared secret |
| `Authorization` | `Bearer <token>` when a token is configured |
| `Idempotency-Key` | the body's `eventId` (n8n dedupes on the body `eventId`, not this header) |

### What ClientFlow requires back

`2xx` with JSON containing **`success: true`**, **`eventId`** equal to the one sent, and **`sentAt`**.
Anything else is a failed delivery:

| Situation | Recorded as |
|---|---|
| Timeout (abort) | `failed: timeout` |
| Non-2xx (400/401/422/502…) | `failed: rejected` (first 500 characters of the body are written to the server log) |
| 2xx but `success` not `true`, `eventId` missing or different, or no `sentAt` | `failed: rejected` ("invalid receipt") |
| Network error | `failed: unavailable` |

---

## 3. Events

Five event types, matched case-sensitively against `eventType`.

| `eventType` | Sent when | Link | `eventId` shape |
|---|---|---|---|
| `intake.send` | New client is created; staff "Send / resend intake" | `formUrl` | `intake-<assignmentId>` (new client) · `intake.send:<assignmentId>:<communicationId>` (staff) |
| `form.send` | Staff send a program or general form | `formUrl` | `form.send:<assignmentId>:<communicationId>` |
| `contract.send` | Contract sent, or its signing link resent | `contractUrl` (signing link) | `contract.send:<contractId>:<communicationId>` (staff) · `contract.send:<contractId>:<hash>` (automatic) |
| `contract.copy` | Signed copy: automatic on signature, or staff "Send copy" | `executedCopyUrl` (never a signing link) | `contract.copy:<contractId>:<communicationId>` |
| `welcome.send` | After signature, staff "Send / resend welcome", automation `send_email` rules | none | `welcome.send:<contractId>` (automatic) · `welcome.send:<contractId>:<communicationId>` (staff) · `automation.email:…` (rules) |

Intake is **only** `intake.send`. ClientFlow no longer sends `form.send` + `formPurpose`.

Order after a signature: `contract.copy`, then `welcome.send`. They are independent.

### 3.1 Payloads ClientFlow sends today

Every event carries: `eventId`, `eventType`, `occurredAt`, `organizationId`, `clientId`,
`recipientEmail`, `sentByUserId`.

| Event | Additional fields |
|---|---|
| `intake.send` | `formId`, `formName` ("General Intake Form"), `formUrl`, `clientName`, `dueDate`, `expiresAt` |
| `form.send` | `formId`, `formName`, `formUrl`, `clientName`, `dueDate`, `expiresAt`, `personalMessage` (optional) |
| `contract.send` | `clientName`, `contractName`, `contractUrl`, `programName`, `dueDate` |
| `contract.copy` | `contractId`, `enrollmentId`, `clientName`, `programName`, `contractName`, `executedCopyUrl` (7-day link), `source` (`automation` or `manual_staff_action`) |
| `welcome.send` | `clientName`, `programName`, **`subject`**, **`body`**, `renderMode: "verbatim"`, `welcome{ source, templateId, templateName, versionId, versionNumber, ruleId? }`, `nextStep` (same text as `body`), `attachmentUrl`, `attachmentFileName`, `attachmentMimeType`, `headerImageUrl` |

Only `welcome.send` currently carries ClientFlow-authored `subject` and `body`. See open item **C1**.

Welcome copy resolution (`welcome.source`): active program version → program `welcomeMessage` override →
generic ClientFlow body. Details in `N8N_WELCOME_EMAIL.md`.

---

## 4. The n8n workflow

### 4.1 Node flow

`Webhook → 02 Validate Auth → Normalize ClientFlow Email Payload → 03 Validate Common Payload →
04 Validate Organization → Check Duplicate → Is Duplicate? → 05 Route Event Type (Switch) →
Validate Email Content → Prepare Branded Email → Unresolved Variables? → [Has Attachment? → Download
Attachment → Set Attachment Filename] → Send Gmail → Log Success → receipt`. Failures go to
`Log Failure` and an error response.

All five valid event types share **one** `Validate Email Content → Prepare Branded Email → delivery`
chain. Unknown types get `400 Unsupported Event Type`.

### 4.2 Auth (`02 - Validate Auth`)

Compares the request against n8n instance variables **`CLIENTFLOW_BEARER_TOKEN`** and
**`N8N_CLIENTFLOW_SECRET`**. These must equal ClientFlow's bearer token and shared secret. A mismatch
returns `401 Unauthorized`.

### 4.3 Routing (`05 - Route Event Type`)

A Switch with exact string equality on **raw `body.eventType`**: `form.send`, `contract.send`,
`welcome.send`, `contract.copy`, `intake.send`; anything else is the "Unsupported" fallback.
The Normalize node accepts `eventType` / `event_type` / `type`, but the Switch does **not** read the
normalized value (open item **N1**).

### 4.4 Normalization (`Normalize ClientFlow Email Payload`)

`pick(...)` returns the first alias that is present and non-empty (first listed wins). The raw body is
preserved alongside the normalized object.

| Incoming field(s) | Normalized as | Notes |
|---|---|---|
| `eventType`, `event_type`, `type` | `eventType` | |
| `eventId`, `event_id`, `id` | `eventId` | |
| `source` | `source` | captured, not used |
| `organizationId`, `organization_id`, `orgId` | `organizationId` | allow-listed (see 4.5) |
| `clientId`, `client_id` | `clientId` | |
| `enrollmentId`, `enrollment_id` | `enrollmentId` | captured, not used |
| `clientName`, `client_name`, `fullName` | `clientName` | |
| `clientFirstName`, `firstName`, `client_first_name` | `clientFirstName` | falls back to first token of `clientName` |
| `clientEmail`, `recipientEmail`, `email`, `client_email`, `recipient_email` | `clientEmail` | |
| `programName`, `program_name`, `program` | `programName` | fallback subjects only |
| `subject`, `emailSubject`, `title`, `emailTitle`, `subjectLine` | `subject` | fallback subject generated when none |
| `body`, `emailBody`, `welcomeBody`, `text`, `emailText`, `message` | `body` | |
| `htmlBody`, `emailHtml`, `html`, `bodyHtml` | `htmlBody` | used as-is when present |
| `actionLabel`, `buttonLabel`, `ctaLabel` | `actionLabel` | else per-event default; never a button on welcome |
| `templateVersionId`, `template_version_id`, `templateVersion` | `templateVersionId` | captured, never used |

Link (`actionUrl`) by event:

| Event | Fields tried, in order | Required |
|---|---|---|
| `contract.copy` | `executedCopyUrl`, `copyUrl`, `documentUrl` | **Yes**. The signing URL is never consulted. |
| `contract.send` | `signingUrl`, `contractUrl`, `signUrl` | **Yes** |
| `form.send` | `formUrl`, `actionUrl`, `url`, `link` | **Yes** |
| `intake.send` | `intakeUrl`, `formUrl`, `actionUrl`, `url`, `link` | No (becomes the button if present) |
| any other | `actionUrl`, `url`, `link` | No |

Attachments are normalized to `[{ fileName, url, mimeType }]`:

- `attachments` as an array is used directly; a single object is wrapped.
- Otherwise `attachmentUrl` builds one item: `fileName` = `attachmentName` ?? `attachmentFileName`,
  `mimeType` = `attachmentMimeType` ?? `attachmentContentType`.
- Per item: `fileName` ← `fileName`/`name`/`filename`; `url` ← `url`/`href`; `mimeType` ←
  `mimeType`/`contentType`/`type`. Items without a URL are dropped.

Not read anywhere: `formPurpose`. `contractName` is read only from the raw body, for the `contract.copy`
fallback subject.

### 4.5 Validation

**`03 - Validate Common Payload`** (every event): non-empty `eventId`, `eventType`, `organizationId`,
`clientId`, `clientName`, `clientEmail`; email must match `^[^\s@]+@[^\s@]+\.[^\s@]+$`.
Failure: `400 Invalid Request` with a `details` array.

**`04 - Validate Organization`**: raw `body.organizationId` must be `org_ea_management` or
`cmqf2ufsl0000vjuwsae510hj`. Failure: `400 Invalid Organization`.

**`Validate Email Content`** (per event, after routing): `eventType`, `eventId`, `clientEmail` present;
**`body` or `htmlBody` must be non-empty**; and the link rule:

| Event | Body or htmlBody | Link |
|---|---|---|
| `intake.send` | required | not required |
| `form.send` | required | form URL required |
| `contract.send` | required | signing URL required |
| `contract.copy` | required | executed-copy URL required |
| `welcome.send` | required | not required |

Failure: `400 Content Invalid`, `errorCode: "VALIDATION_FAILED"`, `message` = first detail.

**Unresolved-token guard** (`Prepare Branded Email → Unresolved Variables?`): if `{{ … }}` survives into
the subject, body or htmlBody: `422`, `errorCode: "VALIDATION_FAILED"`,
"Content contains unresolved template variables". Nothing is emailed.

### 4.6 Content and branding (`Prepare Branded Email`)

- **Subject:** ClientFlow's `subject` always wins. Fallbacks apply only when none is supplied:
  welcome → "Welcome to <programName>" (or "Welcome"); `contract.copy` → "Your signed <contractName or
  agreement>".
- **Body:** `htmlBody` is used as-is; otherwise the plain `body` is converted to HTML paragraphs. The
  text itself is not altered.
- **Button:** built from `actionUrl` with `actionLabel` or a per-event default (`contract.send` "Review &
  Sign Contract", `contract.copy` "View Signed Agreement"). **Never added to `welcome.send`.**
- **Frame around every email, including welcome:** header is the organization logo (`headerImageUrl` /
  `logoUrl`) or the text "EA MANAGEMENT"; footer is "Thank you, / EA Management" (also appended to the
  plain-text version). The old invented welcome wording ("Welcome, {name}!", "Thank you for completing the
  previous step", "Your next step:") is gone.

### 4.7 Attachments

- Both the flat form (`attachmentUrl` + name/type) and the array form are accepted.
- **Only the first attachment is sent**; the rest are ignored.
- Flow: `Has Attachment?` (non-empty URL) → `Download Attachment` (HTTP GET, binary `data`) → `Set
  Attachment Filename` → Gmail with the binary attached.
- Filename missing → `attachment`. MIME type missing → left unset, and Gmail uses the type detected
  during download.
- Download failure → `Log Failure` → `502 Email Delivery Failure`.

The welcome guide's URL is a presigned link valid about 15 minutes; n8n must fetch it promptly.

### 4.8 Idempotency (`clientflow_email_log`)

Data table `clientflow_email_log` (`BYrLHMRvAKzVRCb7`), columns: `event_id`, `organization_id`, `client_id`,
`form_id`, `recipient_email`, `event_type`, `status`, `sent_at`.

- `Check Duplicate` looks up `event_id == body.eventId` (limit 1). `Is Duplicate?` treats **any** returned
  row as a duplicate, whatever its status.
- Duplicate → `200 { success: true, status: "ALREADY_SENT", eventId, clientId, formId, recipientEmail }`.
- Success writes `status: "SENT"`; failure writes `status: "FAILED"` with the same `event_id`.
- A deliberate resend needs a **new** `eventId`. ClientFlow generates one per attempt.

### 4.9 Receipts (what n8n returns)

Success and failure both return structured JSON (`providerMessageId`, `sentAt`, `errorCode` on failure),
synchronously on the webhook response.

---

## 5. Compatibility: ClientFlow's fields vs n8n's aliases

| ClientFlow sends | n8n reads it as | Status |
|---|---|---|
| `eventType` | Switch on raw `body.eventType` | ✅ always sent under this name |
| `recipientEmail` | `clientEmail` alias | ✅ |
| `clientName` | `clientName` | ✅ sent for every event (optional in the `form.send` type, but always populated) |
| `contractUrl` (contract.send) | `actionUrl` via `signingUrl` → `contractUrl` | ✅ |
| `formUrl` (form.send, intake.send) | `actionUrl` | ✅ |
| `executedCopyUrl` (contract.copy) | `actionUrl` | ✅ |
| `subject`, `body` (welcome) | `subject`, `body` | ✅ |
| `attachmentUrl`, `attachmentFileName`, `attachmentMimeType` | attachment item (`attachmentName` wins over `attachmentFileName`, ClientFlow doesn't send it) | ✅ |
| `headerImageUrl` | header logo | ✅ |
| `organizationId` | allow-list | ⚠ must equal an allowed id (see O1) |
| `contractName` (contract.copy) | raw body only, fallback subject | ✅ works, not normalized |
| `welcome.versionId` (nested) | `templateVersionId` (top-level, unused) | ➖ n8n doesn't log it; ClientFlow does (`CfCommunication.templateContext.welcome`) |
| `enrollmentId` (contract.copy) | captured, unused | ➖ |
| `renderMode`, `nextStep`, `welcome`, `expiresAt`, `dueDate`, `formId`, `programName` (most events) | not read | ➖ ignored, harmless |
| `subject` / `body` for **intake, form, contract.send, contract.copy** | required `body` | ❌ **not sent today, see C1** |

---

## 6. Open items

### ClientFlow

**C1: `body` (and `subject`) are required but ClientFlow only sends them for `welcome.send`.** Per the
audit, `Validate Email Content` requires a non-empty `body`/`htmlBody` for **every** event. ClientFlow does
not send a body for `intake.send`, `form.send`, `contract.send` or `contract.copy`, so those would fail with
`400 Content Invalid / Missing email body` (recorded in ClientFlow as `failed: rejected`) unless n8n has
default bodies for them that the audit did not describe. Confirm this before relying on those events. If
there is no n8n default, ClientFlow needs to author the subject and body for these four events, consistent
with "ClientFlow is the source of truth for client-facing copy".

**C2: `templateVersionId` is not sent top-level** (only nested under `welcome`). Not needed by n8n today.
If n8n should log it for audit, ClientFlow can also send it at the top level.

### n8n

**N1: Route on the normalized event type.** Point the Switch at `normalized.eventType` so the
`event_type` / `type` aliases route.

**N2: Idempotency must distinguish SENT from FAILED.** Today a `FAILED` row makes a retry of the same
`eventId` return `ALREADY_SENT` without sending. Wanted: `SENT` → `ALREADY_SENT`; `FAILED` → allow the
retry of the same attempt (and update the row); new `eventId` → new send.

**N3: `ALREADY_SENT` has no `sentAt`.** ClientFlow rejects a 2xx receipt without `sentAt` as "invalid
receipt", so a replay of an already-sent event would be recorded as failed in ClientFlow even though the
email went out. Return the original `sent_at` from the log row in the `ALREADY_SENT` response.

**N4: Only the first attachment is sent.** Fine for the welcome guide; note if more are ever needed.

**N5: Missing MIME type is not forced.** n8n defers to the downloaded type. Not an issue now that ClientFlow
sends `attachmentMimeType`.

**N6: `contractName` / `formName` are not normalized** (raw body only, for fallback subjects).

### Configuration

**O1: Organization allow-list.** `organizationId` must be `org_ea_management` or
`cmqf2ufsl0000vjuwsae510hj`. ClientFlow sends `N8N_ORGANIZATION_ID` if set, else the client's real
organization id. Make sure one of these applies in production or every email is a `400 Invalid
Organization`.

**O2: Timeout.** ClientFlow waits 15 s by default. The webhook is synchronous and may download an
attachment and call Gmail. If ClientFlow times out first, it records `failed: timeout` although n8n may
still send the email. Consider `N8N_FORM_EMAIL_TIMEOUT_MS` of 30 000 or more.

**O3: Secrets must match.** ClientFlow's shared secret and bearer token must equal n8n's
`N8N_CLIENTFLOW_SECRET` and `CLIENTFLOW_BEARER_TOKEN`.

### Not yet verified

The full webhook path has not been run live. The auth step needs the real instance variables, so the
automated test stopped at `401`. The Gmail send is unproven. The first real intake, contract, copy and
welcome sends are the actual test, so watch the Communications tab and the trace query below.

---

## 7. Tracing and troubleshooting

Every ClientFlow send leaves a trail (manual sends record who did it; `source` is `manual_staff_action`
or `automation`):

| Where | What |
|---|---|
| ClientFlow **Communications tab** / `CfCommunication` | one row per attempt: `type` (`intake_email`, `form_email`, `contract_email`, `contract_copy_email`, `welcome_email`, `program_email`), `status` (`REQUESTED` → `SENDING` → `SENT` / `FAILED`), `errorCode`, `eventId` |
| ClientFlow **Activity tab** / `CfActivityLog` | `INTAKE_EMAIL_SENT`, `FORM_EMAIL_SENT`, `CONTRACT_SENT`, `CONTRACT_COPY_SENT`, `WELCOME_SENT` and their `_FAILED` variants |
| `CfCommunication.templateContext -> 'welcome'` | which welcome version produced the wording |
| ClientFlow server log | `welcome.send eventId=… source=… templateId=… versionId=…`; and the first 500 characters of any non-2xx n8n response |
| n8n `clientflow_email_log` | one row per `eventId` with `status` and `sent_at` |

Reading `errorCode`:

| `errorCode` | Meaning |
|---|---|
| `disabled` / `not_configured` | ClientFlow's n8n settings are off or incomplete; nothing was sent |
| `timeout` | ClientFlow gave up waiting (see O2); check n8n's log for whether it sent |
| `rejected` | n8n returned non-2xx or an invalid receipt: `400` (validation, org, unsupported event, missing body or URL), `401` (auth), `422` (unresolved `{{ }}`), `502` (Gmail/attachment). Look at the server log for n8n's `errorCode` |
| `unavailable` | network failure reaching n8n |

Which welcome version produced recent emails (read-only, Neon SQL editor):

```sql
SELECT "createdAt", "eventId", status, source AS trigger,
       "templateContext" -> 'welcome' ->> 'source'        AS "copySource",
       "templateContext" -> 'welcome' ->> 'versionId'     AS "versionId",
       "templateContext" -> 'welcome' ->> 'versionNumber' AS "versionNumber",
       left("renderedBody", 80)                            AS "bodyStart"
FROM "CfCommunication"
WHERE type IN ('welcome_email', 'program_email')
ORDER BY "createdAt" DESC LIMIT 20;
```
