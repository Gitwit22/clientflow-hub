# n8n: `contract.copy` event

ClientFlow emails a client the **fully signed copy** of their contract by sending a new event type,
`contract.copy`, to the same n8n webhook that already handles `form.send`, `contract.send` and
`welcome.send`. **The n8n workflow needs a matching branch before this backend change is deployed to
production.** Until it exists, each attempt is recorded as `FAILED` (with an admin notification) and
signing and the welcome email are unaffected.

## When it fires

| Trigger | Source recorded | Idempotency key |
|---|---|---|
| The client signs and the contract becomes `COMPLETED` (automatic, the default) | `automation` | `auto:contract.copy:<contractId>` |
| Staff clicks **Send copy** on a signed contract | `manual_staff_action` | one UUID per click, reused on retry |

Order after a signature: **`contract.copy` first, then `welcome.send`.** They are independent: a
failed copy never blocks the welcome email.

This event never carries a signing link and never changes the contract.

## Request

Same transport as the other events: `POST` to the n8n webhook URL with these headers.

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
  "expiresAt": "2026-10-05T12:00:00.000Z",
  "sentByUserId": "admin_123"
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
| `expiresAt` | yes | when `executedCopyUrl` stops working (7 days after sending) |
| `sentByUserId` | yes | the staff member who clicked Send copy, or `system` for the automatic send |

### `executedCopyUrl`

A presigned object-storage URL valid for **7 days**. Put it behind a button or link in the email and
say when it expires (`expiresAt`); do not re-host or cache it. If a client needs a new link later,
staff use **Send copy** again, which issues a fresh URL.

## Required response

Exactly like the other events, respond `200` with a receipt that **echoes the `eventId`**:

```json
{
  "success": true,
  "status": "SENT",
  "eventId": "contract.copy:<contractId>:<communicationId>",
  "sentAt": "2026-09-28T12:00:02.000Z"
}
```

ClientFlow treats a non-2xx response, a missing/mismatched `eventId`, or a missing `sentAt` as a
rejected delivery. It records `FAILED`, writes a `CONTRACT_COPY_FAILED` activity entry, and notifies
org admins.

## Suggested email

- **Subject:** `Your signed agreement: {{contractName}}`
- **Body:** greet `clientName`; say the agreement for `programName` is signed and complete; link
  **Download signed copy** to `executedCopyUrl`; note the link expires on `expiresAt` and that they
  can reply to request a new one.

## How to verify after building the branch

1. Sign a test contract in a staging organization. Within a minute you should get the signed-copy
   email, then the welcome email.
2. In ClientFlow, open the client's Communications tab: a `contract_copy_email` row should read
   `SENT`, and the Activity tab should show `CONTRACT_COPY_SENT`.
3. On the signed contract, click **Send copy**. You should receive a second email, and a second
   `contract_copy_email` row should appear (a new attempt, so a new `eventId`).
