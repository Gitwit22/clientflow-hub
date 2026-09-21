# ClientFlow API Routes

## Status

Health, intake, and contract-preparation lifecycle slices are implemented. Compatibility and future business endpoints remain scaffold routes returning HTTP 501 with code `CLIENTFLOW_NOT_IMPLEMENTED`.

## Implemented intake lifecycle

All paths use the `/api/v1` prefix.

### Create client and assign intake

`POST /clients` creates the client, reuses the organization's active `master_core` form template (or creates a deterministic fallback), creates a sent assignment, stores only a SHA-256 token hash, and records activity in one transaction. The response contains the only copy of the public URL. n8n delivery occurs after commit and returns `sent`, `skipped`, or `failed` without rolling back creation.

This route is a staging-only bridge. It returns HTTP 403 unless `ALLOW_UNAUTHENTICATED_CLIENT_CREATION=true`, and that flag is rejected when `NODE_ENV=production`.

```json
{
	"organizationId": "organization-id",
	"contactName": "Jordan Taylor",
	"businessName": "Taylor Creative LLC",
	"email": "jordan@example.com",
	"phone": "+1 313 555 0100",
	"intakeSource": "admin_created",
	"assignedStaffId": "optional-admin-user-id"
}
```

When a program is selected, its name must match exactly one active same-organization program. The response includes `program`, `nextAction`, optional safe `contract` metadata, and `emailDelivery`. Staff-review programs finish as `PENDING_STAFF_REVIEW`; auto-contract programs finish as `CONTRACT_SENT`.

## Implemented contract preparation

### Generate contract

`POST /clients/:id/contracts/generate` validates the client, selected active program, and active default contract template. It creates or reuses a non-terminal draft, rotates its secure token, and returns safe metadata plus a one-time public URL. The stored SHA-256 hash and generated legal content are not returned.

### Send contract

`POST /clients/:id/contracts/send` accepts:

```json
{
	"contractId": "contract_123"
}
```

It verifies ownership, rotates the public token, marks the contract `SENT`, marks the client `CONTRACT_SENT`, appends `Contract sent` activity, records a communication event, and attempts n8n delivery after commit. Disabled or failed delivery does not revert issuance.

Both staff routes return HTTP 403 unless `ALLOW_UNAUTHENTICATED_CONTRACT_MANAGEMENT=true`; production configuration rejects that value.

### Public contract placeholder

`GET /public/contracts/:token` returns HTTP 501 with `CLIENTFLOW_NOT_IMPLEMENTED`. Signing is not part of this slice.

### Open public intake

`GET /public/forms/:token` hashes the inbound token, rejects cancelled/expired links with a uniform not-found response, and returns assignment metadata, public form fields, and safe client prefill values.

### Submit public intake

`POST /public/forms/:token/submit` validates form keys, required answers, email/select values, and prevents repeat submission atomically. It marks the assignment submitted, merges `programOfInterest` into client intake when selected, updates status to `PROGRAM_SELECTED` or `INTAKE_SUBMITTED`, and records activity.

```json
{
	"answers": {
		"contactName": "Jordan Taylor",
		"email": "jordan@example.com",
		"selectedProgram": "Event Planning"
	}
}
```

## Existing compatibility contract

All paths use the `/api/v1` prefix.

### Authentication and organization

- `POST /auth/login`, `/auth/refresh`, `/auth/logout`, `/auth/change-password`, `/auth/accept-invite`
- `GET /auth/me`, `/auth/session`, `/auth/validate-invite`
- `PATCH /auth/me`
- `GET|PATCH /organizations/:orgId/settings`
- `GET /organizations/:orgId/members`
- `POST /organizations/:orgId/invitations`
- `POST /organizations/:orgId/invitations/:memberId/revoke`
- `PATCH /organizations/:orgId/members/:memberId/role`
- `POST /organizations/:orgId/members/:memberId/disable|enable`

### ClientFlow administration

Base path: `/admin/cf`

- Clients: `GET|POST /clients`, `GET|PATCH|DELETE /clients/:id`
- Programs: `GET|POST /programs`, `GET /programs/:id/detail`, `PATCH /programs/:id`
- Enrollments: `GET|POST /enrollments`, `GET|PATCH /enrollments/:id`, `GET /enrollments/:id/history`
- Forms: `GET|POST /form-templates`, `PATCH|DELETE /form-templates/:id`, `GET|POST /form-assignments`, `PATCH /form-assignments/:id`, `POST /form-assignments/:id/send`
- Intake: `GET /intake-submissions`, `GET /intake-submissions/:id`
- Notifications: `GET /notifications`, `PATCH /notifications/read-all`, `PATCH /notifications/:id/read`
- Terms: `GET /terms`, `GET|POST /clients/:clientId/terms`, `PATCH /terms/:id`
- Monitoring: `GET /monitoring`, `POST /enrollments/:enrollmentId/monitoring`, `POST /enrollment-monitoring/:id/results`, `GET /enrollment-monitoring/:id/history`
- Contracts: `GET /contracts`, `GET|POST /clients/:clientId/contracts`, `PATCH /contracts/:id`
- Documents: `GET /documents`, `GET /clients/:clientId/documents`, `POST /clients/:clientId/documents/upload-intent`, `POST /documents/:id/complete-upload`, `GET /documents/:id/download`
- Communications: `GET /communications`, `GET|POST /clients/:clientId/communications`
- Reports: `GET /final-reports`, `GET|POST /clients/:clientId/final-reports`
- Activity: `GET|POST /activity`, `GET /clients/:clientId/activity`
- Demo/live mode: `GET /demo-status`, `POST /seed-demo`, `POST /remove-demo`

### Compatibility public forms (not implemented)

- `GET /public/form/:token`
- `POST /public/form/:token/submit`

## Future groups

Authentication, users, organizations, program/form administration, contract signing/completion, terms, monitoring, documents, communications, reports, archive, inbound webhooks, email administration, and audit APIs remain future work.

Do not switch the frontend to normalized paths until parity handlers, authorization, persistence, and compatibility tests are complete.

## Known gaps

Public contract signing, explicit archive/restore commands, webhook status ingestion, retry processing, and first-class `ClientContact`, `FormAnswer`, and `WebhookEvent` models require later design and migrations.
