# Contract Lifecycle

## Boundary

The implemented lifecycle covers contract preparation, secure public opening and acceptance, onboarding, initial monitoring, and welcome email delivery. External e-signature providers, retry workers, and enrollment creation remain outside this slice.

## Post-intake rules

| Program | Rule | Template |
| --- | --- | --- |
| Brand Awareness Subscription | Auto-contract | Brand Awareness Service Agreement |
| 30-Day Premier Workshop Subscription | Auto-contract | Premier Workshop Service Agreement |
| Event Planning | Staff review | Event Planning Agreement |
| Commercial Property | Staff review | Commercial Property Service Agreement |
| Grant | Staff review | Grant Agreement |
| Sponsorship | Staff review | Sponsorship Agreement |
| Interest | Staff review | General Services Agreement |
| Other / Unsure | Staff review | General Services Agreement |

A submitted program name must match exactly one active `CfProgram` in the assignment organization. The client stores both the real `programId` and the submitted name in `intake.programOfInterest`.

Staff-review programs set the client to `PENDING_STAFF_REVIEW`, create activity `Pending staff review before contract`, and return `nextAction: STAFF_REVIEW_REQUIRED`. They do not create a contract or email event.

Auto-contract programs generate an immutable content snapshot from the active default template, issue it as `SENT`, set the client to `CONTRACT_SENT`, create activity `Contract sent`, and record a `CfCommunication` email event. n8n delivery is post-commit and non-fatal.

## Contract templates

The additive migration creates seven organization-scoped templates. Every placeholder includes:

> Template draft only. Final legal language must be reviewed by the organization before use.

Existing contract content is preserved. Existing contract rows are linked to their matching template name or the General Services Agreement fallback. Recognized legacy statuses are normalized to `DRAFT`, `SENT`, `OPENED`, `COMPLETED`, `CANCELLED`, or `EXPIRED`; unknown historical values are preserved.

## Secure links

Contract tokens use 32 random bytes encoded as base64url. Only a SHA-256 hash is persisted. Generate returns a one-time public URL. Send and resend rotate the token, invalidating the prior URL because a stored hash cannot reconstruct the original token.

`GET /api/v1/public/contracts/:token` validates the link and returns the immutable content snapshot plus safe client/program display metadata. Its first successful open moves `SENT` to `OPENED`, sets the client to `CONTRACT_OPENED`, and records activity. Malformed, unknown, expired, completed, and unavailable links share one not-found response.

`POST /api/v1/public/contracts/:token` requires `signedName`, a valid `signedEmail`, and `agreedToTerms: true`; `signatureNote` is optional. One atomic transaction persists the acceptance metadata and request IP/user agent, marks the contract `COMPLETED`, invalidates its token, moves the client to `ONBOARDING`, creates a pending `Initial Follow-Up`, records activity, and creates the welcome communication event. Repeat submissions cannot create duplicate tasks because the contract transition is guarded and `contractId` is unique on `CfMonitoringTask`.

The follow-up due date is 7, 14, 30, or 90 days for Weekly, Biweekly, Monthly, or Quarterly program defaults. Unknown and Custom values safely fall back to 7 days. Monitoring statuses are `PENDING`, `COMPLETED`, `OVERDUE`, and `CANCELLED`.

## Email event

Contract issue creates a unique communication event before calling n8n. Its status is:

- `requested` before an enabled delivery attempt
- `sent` after n8n accepts the payload
- `failed` after rejection, timeout, or network failure
- `skipped` when n8n is disabled or incomplete

A skipped or failed delivery does not revert `CfContract.status=SENT` or `CfClient.status=CONTRACT_SENT`.

```json
{
  "eventType": "contract.send",
  "organizationId": "org_ea_management",
  "clientId": "client_123",
  "recipientEmail": "client@example.com",
  "clientName": "Client Name",
  "programName": "Brand Awareness Subscription",
  "contractName": "Brand Awareness Service Agreement",
  "contractUrl": "https://clientflow.nxtlvltechnology.com/contracts/token",
  "dueDate": "2026-09-28"
}
```

Headers include `x-clientflow-secret: CLIENTFLOW_N8N_SECRET`, `Idempotency-Key`, JSON content type, and optional bearer authorization.

Contract completion also records a durable `welcome_email` communication before sending this exact event:

```json
{
  "eventType": "welcome.send",
  "organizationId": "org_ea_management",
  "clientId": "client_123",
  "recipientEmail": "client@example.com",
  "clientName": "Client Name",
  "programName": "Brand Awareness Subscription",
  "nextStep": "Your onboarding has started. A team member will follow up with you soon."
}
```

Disabled or failed welcome delivery does not undo contract completion or onboarding. An accepted delivery updates the communication to `sent` and records `WELCOME_SENT`; the client remains `ONBOARDING`.
