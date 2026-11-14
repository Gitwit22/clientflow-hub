# Program-wide email (`program.email`)

Programs › a program card or the program's Emails tab › **Send email blast** sends one message to
every member of the program (the default) or to the members staff choose. ClientFlow sends **one
webhook per recipient** (so addresses stay private), from the server, in the background. Each recipient is a `CfCommunication` row (`type: program_email`, `programEmailId`), so
it also shows on the client's Communications tab.

## Payload

```json
{
  "eventType": "program.email",
  "eventId": "program.email:<programEmailId>:<communicationId>",
  "occurredAt": "2026-10-22T15:00:00.000Z",
  "organizationId": "<org>",
  "clientId": "<client id>",
  "sentByUserId": "<admin id>",
  "recipientEmail": "member@example.com",
  "clientName": "Tamika Smith",
  "programName": "The Inspired Detroit Initiative",
  "programEmailId": "<programEmailId>",
  "subject": "Grant day this Saturday",
  "body": "Hello everyone,\n\n• Bring your plan …",
  "bodyHtml": "<p style=\"margin:0 0 16px 0;\">Hello everyone,</p>…",
  "headerImageUrl": "https://… (the organization's Settings logo, when set)"
}
```

Staff can format the message (**bold**, _italic_, bulleted and numbered lists, links, images).
`bodyHtml` is the formatted version (all text escaped; only p, br, strong, em, ul, ol, li,
http/mailto links, and `img`); `body` is the plain-text version with the formatting markers
removed (an image becomes `[Image: alt text]`).

Images: an `img` only ever points at the organization's own uploaded email images in the public
assets bucket (`R2_PUBLIC_ASSETS_URL/email-images/<organizationId>/…`), checked by ClientFlow before
preview and send; any other image is refused. n8n uses `bodyHtml` as-is (verified on the live
workflow), so no n8n change is needed for images.

### Test send

"Send test to me" sends one copy, `subject` prefixed `[Test] `, to the signed-in staff member with
`eventId` `program.email.test:<uuid>` (new each time), `programEmailId` `test`, and the staff
member's id/name in `clientId`/`clientName` (the workflow requires them non-empty; it never looks a
client up). Nothing is recorded in ClientFlow's email history. The workflow logs it in its email
log like any send.

The copy is ClientFlow's, as staff wrote it, like `welcome.send`: n8n adds only the shared
header image and the "Thank you, EA Management LLC" sign-off. Each recipient's `eventId` never
changes, so a retry (or a resend after a server restart) of a copy n8n already sent hits the
workflow's "Check Duplicate" step and returns `ALREADY_SENT` instead of emailing again.

A receipt `{ success: true, status: "SENT" }` means Gmail **accepted** the message. ClientFlow shows
it as "Accepted" and never claims it was delivered to the inbox.

## n8n change (one rule)

Program emails reuse the welcome branch, which already renders `subject` + `bodyHtml` with the
platform's header and sign-off and checks for `subject`, `body`, `recipientEmail`, `clientName` and
`programName` (all present).

Prompt for the n8n AI builder:

> In the workflow "CLIENTFLOW - Send Form Email", open "05 - Route Event Type" (Switch) and add one
> rule after the existing ones and before the fallback: `{{ $("01 - ClientFlow Webhook").item.json.body.eventType }}`
> (string, equals, case sensitive) equals `program.email`. Connect that new output to the existing
> node "WELCOME - Validate Payload". Do not change any other node, connection or the fallback.
> Save and **Publish**.

Until the rule is published, n8n answers `program.email` with 400 "Unsupported eventType": every
recipient is recorded as failed (`n8n_http_400`) and **Retry failed** on the program's email history
sends them once the rule is live.
