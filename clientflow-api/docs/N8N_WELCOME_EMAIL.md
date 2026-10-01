# n8n: `welcome.send` renders ClientFlow's wording verbatim

**ClientFlow is the source of truth for the welcome email's wording.** The Program page's active
welcome version (subject, body, attachment) decides what the client reads. n8n handles delivery and
branding only.

## Why the email had extra wording

The `welcome.send` payload used to carry the body only as `nextStep`, with no subject. The n8n
workflow put that into its own template:

```
Welcome, {{clientName}}!                       <- added by n8n
Thank you for completing the previous step...  <- added by n8n
Your next step:                                <- added by n8n
{{nextStep}}                                   <- the Program's welcome version (correct)
We are glad to have you...                     <- added by n8n
Thank you, EA Management                       <- added by n8n
```

That wording exists nowhere in ClientFlow, so it can only come from the n8n workflow. The middle of the
email was right; the beginning and end were n8n's.

## What ClientFlow sends now

| Field | Meaning |
|---|---|
| `subject` | The resolved subject, exactly as it should read (variables already substituted). |
| `body` | The resolved body, exactly as it should read (variables substituted; plain text with `\n` line breaks). |
| `bodyHtml` | `body` as HTML: escaped, blank lines become paragraphs and single line breaks become `<br>`. The HTML part of the email uses it; `body` stays the plain-text part. |
| `renderMode` | Always `"verbatim"`: send `body` as the message with **no business wording added before or after it**. |
| `welcome` | Which ClientFlow copy produced this email (see below). |
| `nextStep` | The same text as `body`. Kept only so the current n8n validation keeps passing; new logic should not use it. |
| `attachmentUrl` | Presigned URL of the welcome guide (valid ~15 minutes; fetch it as soon as the event arrives). Absent when no guide is configured. |
| `attachmentFileName` | The guide's real filename, e.g. `IDI Member Welcome Guide.pdf`. Use it as the attachment name instead of deriving one from the URL. Sent only with `attachmentUrl`; path separators and control characters are already removed. |
| `attachmentMimeType` | The guide's MIME type, e.g. `application/pdf`. Sent only with `attachmentUrl`. |
| `headerImageUrl` | Permanent public URL of the organization's logo. Absent when none is configured. |
| `clientName`, `programName`, `recipientEmail`, `organizationId`, `clientId`, `sentByUserId`, `eventId`, `eventType`, `occurredAt` | As before. |

`welcome`:

```json
{
  "source": "program_version",
  "templateId": "…",
  "templateName": "IDI Membership Welcome",
  "versionId": "…",
  "versionNumber": 3
}
```

`source` is one of:

| `source` | Meaning |
|---|---|
| `program_version` | The program's **active welcome version** was used. `templateId`, `versionId`, `versionNumber` are set. |
| `program_message` | No active version, so the program's own `welcomeMessage` override was used. |
| `default` | No active version and no override, so the generic ClientFlow body was used ("Your onboarding has started…"). |
| `automation_rule` | A program automation `send_email` rule (`ruleId` is set). Its own subject and message are sent verbatim. |

Fallback order, unchanged: **active program version → program message override → generic body.**

## What the n8n workflow should do

For events where `renderMode === "verbatim"`:

1. **Subject:** `{{ $json.subject }}`.
2. **Message:** `{{ $json.body }}` exactly. Escape HTML, and turn blank lines into paragraphs and single
   newlines into `<br>`. Do not add a greeting, a lead-in, or a closing.
3. **Header:** the `headerImageUrl` image, when present.
4. **Attachment:** download `attachmentUrl` and attach it under `attachmentFileName` with type
   `attachmentMimeType`, when present. If either is missing, fall back to the response's
   `Content-Disposition` / `Content-Type` rather than the URL.
5. **Footer (optional):** only a fixed, non-business footer such as the organization name or address.
   Do not repeat a sign-off; the configured body already ends with one (for example
   `EAM-Team "Inspire to be Great"`).
6. **Receipt:** respond as before with `success`, `eventId` (echoed) and `sentAt`.

Remove from the workflow's welcome template: `Welcome, {{clientName}}!`, `Thank you for completing the
previous step…`, `Your next step:`, `We are glad to have you…`, and `Thank you, EA Management`.

### Safe rollout

Branch on `renderMode`. Events with `renderMode === "verbatim"` (everything ClientFlow now sends) use the
new layout. Anything without it keeps the old layout, so nothing breaks while you edit the workflow. Once
you've confirmed the new layout, delete the old branch.

## Tracing an email back to its wording

The selected copy is recorded three ways for every welcome email:

1. **In the webhook payload** (`welcome`, above).
2. **On the communication row:** `CfCommunication.templateContext -> 'welcome'`, alongside the exact
   `renderedSubject` and `renderedBody` that were sent.
3. **In the server log:** `welcome.send eventId=… source=… templateId=… versionId=… trigger=…`
   (no client data).

To see which version produced recent welcome emails (read-only, run in the Neon SQL editor):

```sql
SELECT
  "createdAt",
  "eventId",
  status,
  source AS trigger,
  "templateContext" -> 'welcome' ->> 'source'        AS "copySource",
  "templateContext" -> 'welcome' ->> 'templateName'  AS "templateName",
  "templateContext" -> 'welcome' ->> 'versionId'     AS "versionId",
  "templateContext" -> 'welcome' ->> 'versionNumber' AS "versionNumber",
  left("renderedBody", 80)                            AS "bodyStart"
FROM "CfCommunication"
WHERE type IN ('welcome_email', 'program_email')
ORDER BY "createdAt" DESC
LIMIT 20;
```

Emails sent before this change have no `welcome` key in `templateContext` (it shows as empty), but their
`renderedBody` is stored, which is how you can confirm the middle of an older email matched the Program's
version.
