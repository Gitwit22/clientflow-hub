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

That sentence is **no longer appended** to generated agreements; it only remains inside starter
template text, and the program page warns staff while an active version still contains it.

### Agreement purposes

A program can have several named agreement templates (`CfProgramContractTemplate.purpose`):

- `enrollment`: what a client signs to join. The program's enrollment agreement is the one
  `CfProgramWorkflowConfig.activeContractTemplateId/VersionId` names. Only it drives onboarding,
  the welcome email gate and automation. The first enrollment template saved for a program becomes
  its enrollment agreement automatically.
- `award`: generated per funding award. Each template keeps its own `activeVersionId`. An award
  template can never be the enrollment agreement, and every "current contract" lookup on the
  enrollment path filters award agreements out (`ENROLLMENT_AGREEMENT_WHERE`).

### Merge fields and review

Templates may use merge fields (`contracts/merge-fields.ts`): `{{client.contactName}}`,
`{{client.businessName}}`, `{{client.email}}`, `{{program.name}}`, `{{organization.name}}`,
`{{enrollment.startDate}}`, `{{today}}`, and in award agreements only `{{award.title}}`,
`{{award.source}}`, `{{award.amount}}`, `{{award.date}}`.

- Saving a version rejects unknown fields and award fields in an enrollment agreement.
- Generating an agreement fills the fields; a field with no value blocks generation (400).
- `POST /clients/:id/contracts/preview` returns the agreement exactly as the client will read it,
  the fields still missing, and a `contentHash`. Staff generate with `reviewedVersionId` +
  `reviewedContentHash`; if the active version or the filled-in text changed since, generation is
  refused with 409. Automation (no review fields) is unchanged.
- An agreement already in progress previews its stored text. Sent and signed agreements always keep
  the text they were generated with.

Existing contract content is preserved. Existing contract rows are linked to their matching template name or the General Services Agreement fallback. Recognized legacy statuses are normalized to `DRAFT`, `SENT`, `OPENED`, `COMPLETED`, `CANCELLED`, or `EXPIRED`; unknown historical values are preserved.

### Award agreements

An award agreement belongs to one funding award (`CfContract.awardId`, `purpose = 'award'`).

- Prepared only for an **approved** award: `POST /awards/:awardId/agreement/preview`, then
  `/generate` with the reviewed version and hash. The award's row is locked while it is created, and
  a partial unique index allows only one open (DRAFT/SENT/OPENED/EXPIRED) agreement per award.
- Sent through the normal `POST /clients/:id/contracts/send`; the award moves to `agreement_sent`.
  Sending, opening and signing it never change the client status or the enrollment.
- Signing records the signature, files and emails the signed copy, and moves the award to
  `agreement_signed`. It does **not** move the client to onboarding, create monitoring, set the
  enrollment start date, send the welcome email, or run `contract.signed` automation.
- Cancelling the award cancels an unsigned agreement (its link stops working). Changing an award's
  title, source, amount or date after an agreement exists requires replacing it: an unsigned one is
  cancelled, a signed one is kept as history, and the award returns to `approved`.
- A link for an agreement that was replaced or whose award was cancelled can no longer be signed.

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
