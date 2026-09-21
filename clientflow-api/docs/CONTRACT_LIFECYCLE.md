# Contract Lifecycle

## Boundary

This slice ends when a contract is issued or a client is placed in staff review. Public contract rendering/signing, completion, welcome email, enrollment, onboarding, and monitoring are not implemented.

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

`GET /api/v1/public/contracts/:token` intentionally returns HTTP 501. It does not look up the token or expose contract data.

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
