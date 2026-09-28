# Frozen outbound contract: `contract.copy`

Baseline: **2026-09-28**, aligned to the rolled-back working n8n email workflow.
The workflow owner confirmed that the n8n branch was updated separately. This change only aligns
ClientFlow; it does not edit or independently verify the live workflow. Do not rename, normalize,
or extend this payload without a separate coordinated change. The exact wire shape is protected by
`src/integrations/n8n/n8n.contract-copy.spec.ts`.

ClientFlow emails the fully signed copy through the existing webhook shared with `form.send`,
`contract.send`, and `welcome.send`.

## When it fires

| Trigger | Source recorded | Idempotency key |
|---|---|---|
| The client signs and the contract becomes `COMPLETED` (automatic, the default) | `automation` | `auto:contract.copy:<contractId>` |
| Staff clicks **Send copy** on a signed contract | `manual_staff_action` | one UUID per click, reused on retry |

Order after a signature: **`contract.copy` first, then `welcome.send`.** They are independent: a
failed copy never blocks the welcome email.

This event never carries a signing link and never changes the contract.

Only `COMPLETED` contracts can send a copy. ClientFlow resolves `executedStoredFileId` to its
stored file and signs that file's storage key. Missing files, unavailable storage, or a non-HTTPS
download URL fail the copy delivery. Automatic sends use the existing `system` actor value;
manual sends use the acting staff user's ID.

A repeated request for an existing attempt returns its recorded outcome without allocating a new
communication or event ID. A transport retry of that same attempt uses the same `eventId` and
`Idempotency-Key`. A deliberate resend creates a new communication and therefore a new `eventId`.
This preserves existing duplicate behavior; it does not introduce a retry queue.

## Request

Same transport as the other events: `POST` to the n8n webhook URL with these headers.

```text
POST https://nxtlvl.app.n8n.cloud/webhook/clientflow/send-form-email
```

Production's resolved webhook URL (`N8N_EMAIL_WEBHOOK_URL`,
`CLIENTFLOW_N8N_FORM_EMAIL_WEBHOOK_URL`, or `N8N_FORM_EMAIL_WEBHOOK_URL`) must remain this endpoint.
Environment-variable precedence, authentication, and the organization override are unchanged.
No per-event endpoint is introduced.

| Header | Value |
|---|---|
| `Content-Type` | `application/json` |
| `x-clientflow-secret` | the shared secret (as for the other events) |
| `Authorization` | `Bearer <token>` when configured (as for the other events) |
| `Idempotency-Key` | equals the body's `eventId` |

### Body

```json
{
  "eventType": "contract.copy",
  "eventId": "contract.copy:<contractId>:<communicationId>",
  "occurredAt": "2026-09-28T12:00:00.000Z",
  "organizationId": "org_123",
  "clientId": "client_123",
  "contractId": "contract_123",
  "enrollmentId": "enrollment_123",
  "recipientEmail": "client@example.com",
  "clientName": "Client Owner",
  "programName": "The Inspired Detroit Initiative",
  "contractName": "Inspired Detroit Service Agreement",
  "executedCopyUrl": "https://<r2-host>/contracts/...-executed.txt?X-Amz-...",
  "sentByUserId": "system",
  "source": "automation"
}
```

| Field | Required | Notes |
|---|---|---|
| `eventType` | yes | always `contract.copy` |
| `eventId` | yes | `contract.copy:<contractId>:<communicationId>`; unique per attempt |
| `occurredAt` | yes | ISO timestamp |
| `organizationId`, `clientId`, `contractId` | yes | |
| `enrollmentId` | no | `null` for contracts not tied to an enrollment |
| `recipientEmail` | yes | the client's email |
| `clientName` | yes | for the greeting |
| `programName`, `contractName` | yes | for the subject / body |
| `executedCopyUrl` | yes | a time-limited download link for the signed document (see below) |
| `sentByUserId` | yes | the staff member who clicked Send copy, or `system` for the automatic send |
| `source` | yes | `automation` or `manual_staff_action` |

### `executedCopyUrl`

A presigned object-storage URL valid for **7 days**. If a client needs a new link later, staff use
**Send copy** again, which issues a fresh URL. It is the only URL in this payload: no `contractUrl`,
`signingUrl`, `formUrl`, public signing token, `expiresAt`, or attachment field is sent.
Sending a copy never generates or rotates a signing token.

## Required response

Exactly like the other events, respond `200` with a receipt that **echoes the `eventId`**:

```json
{
  "success": true,
  "status": "SENT",
  "eventId": "contract.copy:<contractId>:<communicationId>",
  "clientId": "client_123",
  "recipientEmail": "client@example.com",
  "sentAt": "2026-09-28T12:00:02.000Z"
}
```

ClientFlow treats a non-2xx response, `success` other than `true`, a missing/mismatched `eventId`, or a missing `sentAt` as a
rejected delivery. It records `FAILED`, writes a `CONTRACT_COPY_FAILED` activity entry, and notifies
org admins. n8n delivery failures should log `FAILED` and return HTTP 502 using the existing
failure-response convention. Copy failures do not block completion or welcome delivery.

## Agreed n8n branch (maintained separately)

These are the agreed requirements, not a claim that this repository changed live n8n nodes:

1. Extend the existing event router with `eventType = contract.copy`, after common validation.
   Preserve the existing route outputs and fallback behavior. Common validation requires
   `eventId`, `eventType`, `occurredAt`, `organizationId`, `clientId`, `sentByUserId`,
   `recipientEmail`, and `clientName`.
2. `CONTRACT COPY - Validate Payload`: require nonempty `contractId`, `contractName`, `programName`,
   `executedCopyUrl`, `recipientEmail`, and `clientName`. Require `executedCopyUrl` to start with
   `https://`. Invalid requests return HTTP 400 with
   `{ "success": false, "error": "Invalid request", "details": ["..."] }`.
3. `CONTRACT COPY - Prepare Email`: send to `recipientEmail` with the subject/body below.
   Escape interpolated text and the URL attribute when rendering HTML.

   ```text
   Your Signed {contractName} - {programName}

   Hello {clientName},

   Your signed {contractName} for {programName} is ready for your records.

   [View Signed Agreement] -> executedCopyUrl

   Thank you,
   EA Management
   ```

4. Link the CTA only to `executedCopyUrl`; never fall back to another URL. No attachment handling.
   Feed the prepared email into the existing Gmail delivery and `clientflow_email_log` path.
5. Preserve authentication, organization allow-list, duplicate checking, data-table structure,
   Gmail credentials, webhook URL, and the existing form/contract-send/welcome branches.

## Regression checks and scope freeze

Run from `clientflow-api`:

```text
npm test -- --runTestsByPath src/integrations/n8n/n8n.contract-copy.spec.ts src/integrations/integrations.spec.ts src/modules/contracts/contracts.delivery.spec.ts src/modules/contracts/contracts.service.spec.ts src/modules/contracts/contracts.controller.spec.ts
```

Coverage includes the exact payload and common fields, production endpoint and authentication
headers (mocked HTTP), executed-file-only URLs, completion/file gates, automatic ordering,
non-blocking failure reporting, stable retry IDs, and fresh IDs for deliberate manual resends.

`form.send`, `contract.send`, `welcome.send`, and `intake.send` payloads and implementations remain
unchanged. Their shared HTTP transport is unchanged. No live emails are sent by these tests.

## How to verify after building the branch

1. Sign a test contract in a staging organization. Within a minute you should get the signed-copy
   email, then the welcome email.
2. In ClientFlow, open the client's Communications tab: a `contract_copy_email` row should read
   `SENT`, and the Activity tab should show `CONTRACT_COPY_SENT`.
3. On the signed contract, click **Send copy**. You should receive a second email, and a second
   `contract_copy_email` row should appear (a new attempt, so a new `eventId`).
