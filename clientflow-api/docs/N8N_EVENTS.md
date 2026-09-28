# n8n event contract

ClientFlow sends one webhook per email. n8n routes on `eventType` and owns delivery, branding and
receipts. See also `N8N_WELCOME_EMAIL.md` and `N8N_CONTRACT_COPY.md`.

## Events ClientFlow sends

| `eventType` | When | Required link / content | ClientFlow-authored copy |
|---|---|---|---|
| `intake.send` | General Intake email: new client, and staff "Send / resend intake" | `formUrl` | none (n8n's intake wording) |
| `form.send` | A form staff assign (program or general form) | `formUrl` | none (`personalMessage` is optional) |
| `contract.send` | Contract, or resending its signing link | `contractUrl` (a signing link) | none |
| `contract.copy` | Signed copy of a completed contract | `executedCopyUrl` (never a signing link) | none |
| `welcome.send` | After signature, manual welcome, automation `send_email` | none | `subject` + `body` (verbatim) |

Common fields on every event: `eventId`, `eventType`, `occurredAt`, `organizationId`, `clientId`,
`recipientEmail`, `sentByUserId`. `Idempotency-Key` header equals `eventId`.

**Intake is `intake.send`, not `form.send`.** ClientFlow used to send intake as `form.send` with a
`formPurpose: "general_intake"` flag. n8n never read that flag, and `form.send` requires a form URL that
means "a form staff assigned". ClientFlow no longer sends `formPurpose` at all.

## `intake.send` example

```json
{
  "eventType": "intake.send",
  "eventId": "intake.send:<assignmentId>:<communicationId>",
  "occurredAt": "2026-09-28T12:00:00.000Z",
  "organizationId": "org_123",
  "clientId": "client_123",
  "formId": "form_123",
  "formName": "General Intake Form",
  "formUrl": "https://clientflow-2g9.pages.dev/s/<token>",
  "clientName": "Client Owner",
  "dueDate": "2026-10-05T12:00:00.000Z",
  "expiresAt": null,
  "recipientEmail": "client@example.com",
  "sentByUserId": "admin_123"
}
```

The event id is `intake-<assignmentId>` when a new client is created and
`intake.send:<assignmentId>:<communicationId>` when staff resend.

## Receipts ClientFlow expects

`200` with `{ "success": true, "eventId": "<echoed>", "sentAt": "<ISO>", "status": "SENT" }`.
Anything else (non-2xx, a missing or different `eventId`, a missing `sentAt`) is recorded as a failed
delivery. ClientFlow logs the first 500 characters of a non-2xx body, so a structured `errorCode` such as
`VALIDATION_FAILED` shows up in the server log.

## n8n workflow checklist (the parts that live in n8n)

- **Route on the normalized event type**, not the raw body. The Switch should read `normalized.eventType`
  so the `eventType` / `event_type` / `type` aliases the Normalize node accepts actually route.
- **Idempotency must distinguish sent from failed.** A previous row for the same `eventId` means:
  - status `SENT` → return `ALREADY_SENT` (with the original `sentAt` and the same `eventId`), send nothing;
  - status `FAILED` → allow the retry of that same attempt, and update the row;
  - a new `eventId` → a new send (a deliberate resend).
  ClientFlow relies on this: a retry of a failed attempt reuses the `eventId` and must actually send.
- Handle `intake.send` with the intake wording and the `formUrl`; require `formUrl` for it as for `form.send`.
