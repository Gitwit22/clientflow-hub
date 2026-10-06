# Staff invite and password reset emails (`staff.invite`, `staff.password_reset`)

Settings › Invite, "New invite link" and "Password reset link" store a one-time link, email it to
the staff member through the same n8n webhook as client emails, and also show it to the admin to
copy. If n8n doesn't accept the event (for example the branch below isn't built yet, so the
workflow answers 400 "Unsupported eventType"), the request still succeeds and the admin sees
"The email didn't send (…). Copy the link and send it yourself."

Staff aren't clients, but the workflow's common validator requires `clientId` and `clientName`,
so these events carry the staff member's id and name there.

## Payloads

```json
{
  "eventType": "staff.invite",
  "eventId": "staff.invite:<memberId>:<uuid>",
  "occurredAt": "2026-10-07T09:00:00.000Z",
  "organizationId": "<org>",
  "clientId": "<staff member id>",
  "sentByUserId": "<admin id>",
  "recipientEmail": "dana@example.com",
  "clientName": "Dana Smith",
  "actionUrl": "https://<app>/accept-invite?token=…",
  "inviterName": "Erica Admin",
  "organizationName": "EA Management LLC",
  "roleLabel": "Staff",
  "expiresInHours": 72,
  "headerImageUrl": "https://… (when a Settings logo is set)"
}
```

```json
{
  "eventType": "staff.password_reset",
  "eventId": "staff.password_reset:<memberId>:<uuid>",
  "occurredAt": "…", "organizationId": "…", "clientId": "<staff member id>",
  "sentByUserId": "<admin id>", "recipientEmail": "dana@example.com", "clientName": "Dana Smith",
  "actionUrl": "https://<app>/reset-password?token=…",
  "requestedByName": "Erica Admin",
  "organizationName": "EA Management LLC",
  "expiresInMinutes": 60
}
```

Every link gets a new `eventId`, so the duplicate check never swallows a fresh link. The receipt
is the usual `{ success: true, status: "SENT", eventId, sentAt }` from "07 - Success Response".

## Prompt for the n8n AI builder (workflow "CLIENTFLOW - Send Form Email")

> In the workflow "CLIENTFLOW - Send Form Email", add a staff email branch. Do not change any
> existing node or branch.
>
> 1. In "05 - Route Event Type" (Switch), add two rules **after** the existing five and before the
>    fallback, both comparing `{{ $("01 - ClientFlow Webhook").item.json.body.eventType }}`
>    (string, equals, case sensitive) to `staff.invite` and to `staff.password_reset`. Keep the
>    fallback output "Unsupported" connected to "400 Unsupported Event Type". Connect both new
>    outputs to a new Code node "STAFF - Validate Payload".
> 2. "STAFF - Validate Payload" (Code, run once for all items):
>    ```js
>    const body = $('01 - ClientFlow Webhook').first().json.body || {};
>    const details = [];
>    const need = (f) => { const v = body[f]; if (v === undefined || v === null || String(v).trim() === '') details.push('Missing required field: ' + f); };
>    ['actionUrl', 'recipientEmail', 'clientName', 'organizationName'].forEach(need);
>    if (body.eventType === 'staff.invite') need('expiresInHours');
>    if (body.eventType === 'staff.password_reset') need('expiresInMinutes');
>    const u = body.actionUrl ? String(body.actionUrl).trim() : '';
>    if (u && !/^https:\/\//i.test(u)) details.push('actionUrl must begin with https://');
>    return [{ json: { valid: details.length === 0, details, body } }];
>    ```
> 3. "STAFF - Valid?" (If, `{{ $json.valid }}` is true, strict). True → "STAFF - Prepare Email";
>    false → new Respond to Webhook "STAFF - 400 Invalid Payload" (JSON, code 400, body
>    `{{ JSON.stringify({ success: false, error: "Invalid request", details: $json.details }) }}`),
>    same as "FORM - 400 Invalid Payload".
> 4. "STAFF - Prepare Email" (Set, same fields as "CONTRACT - Prepare Email": recipientEmail,
>    emailSubject, emailHtml, emailText, eventId, eventType, organizationId, clientId, all read from
>    `$("01 - ClientFlow Webhook").item.json.body`). Let `b` be that body and
>    `isInvite = b.eventType === 'staff.invite'`.
>    - emailSubject: invite → `You're invited to join {{organizationName}} on ClientFlow`;
>      reset → `Reset your ClientFlow password`.
>    - emailHtml: copy the exact wrapper of "CONTRACT - Prepare Email" (same `<body>` style, the
>      `b.headerImageUrl || b.logoUrl` image table or the "EA MANAGEMENT" banner, and the sign-off
>      `<p>Thank you,<br/>EA Management LLC</p>`). Content:
>      - invite: `<p>Hello ${b.clientName},</p><p>${b.inviterName || 'Your administrator'} invited you to join <strong>${b.organizationName}</strong> on ClientFlow${b.roleLabel ? ' as ' + b.roleLabel : ''}.</p><p>Use the button below to set your password and sign in.</p>`
>        then the button (same style as the contract button: `background-color:#2b6cb0;color:#ffffff;padding:12px 26px;text-decoration:none;border-radius:6px;font-weight:bold;display:inline-block;`)
>        labelled **Set your password** linking to `b.actionUrl`, then
>        `<p>This link works for ${b.expiresInHours} hours and can be used once. If it expires, ask ${b.inviterName || 'your administrator'} for a new one.</p><p>If you weren't expecting this, you can ignore this email.</p>`
>      - reset: `<p>Hello ${b.clientName},</p><p>${b.requestedByName || 'An administrator'} made a link for you to set a new ClientFlow password for <strong>${b.organizationName}</strong>.</p>`
>        then the same button labelled **Reset your password**, then
>        `<p>This link works once, for ${b.expiresInMinutes} minutes. Using it signs you out on other devices.</p><p>If you didn't ask for this, let your administrator know.</p>`
>    - emailText: the same wording as plain text with the link on its own line, ending
>      `Thank you,\nEA Management LLC`.
>    - Do **not** set attachmentUrl.
> 5. Connect "STAFF - Prepare Email" to the existing "Has Attachment?" node (its false output
>    already goes to "06 - Send via Gmail" → "Log Success" → "07 - Success Response").
> 6. Put the four new nodes in a node group "Staff email" like the other branches, validate the
>    workflow and publish it.
