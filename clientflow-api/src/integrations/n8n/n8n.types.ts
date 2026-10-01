export type ClientflowLifecycleEventType =
  | 'form.send'
  | 'intake.send'
  | 'contract.send'
  | 'welcome.send'
  | 'contract.copy'
  | 'form.submitted'
  | 'contract.completed'
  | 'email.status';

interface LifecycleEventBase {
  eventId: string;
  occurredAt: string;
  organizationId: string;
  clientId: string;
  recipientEmail: string;
  sentByUserId: string;
  /** Public URL of the organization's Settings header logo; added to every event when configured. */
  headerImageUrl?: string;
}

// n8n's webhook validator switches on eventType and requires different fields per branch
// (form.send needs formName/formUrl, contract.send needs contractName/contractUrl, welcome.send
// needs clientName/programName/nextStep) - each payload shape below matches its branch exactly so
// TypeScript rejects a payload built for the wrong eventType instead of n8n rejecting it at runtime.
export interface FormSendLifecyclePayload extends LifecycleEventBase {
  eventType: 'form.send';
  formId: string;
  formName: string;
  formUrl: string;
  clientName?: string;
  dueDate?: string;
  expiresAt?: string | null;
  personalMessage?: string;
}

/**
 * The General Intake email has its own event: n8n routes on eventType, so intake is no longer sent as
 * `form.send` with a purpose flag (n8n ignores it, and form.send is for forms staff assign).
 * Like form.send it needs the secure form URL.
 */
export interface IntakeSendLifecyclePayload extends LifecycleEventBase {
  eventType: 'intake.send';
  formId: string;
  formName: string;
  formUrl: string;
  clientName?: string;
  dueDate?: string;
  expiresAt?: string | null;
}

export interface ContractSendLifecyclePayload extends LifecycleEventBase {
  eventType: 'contract.send';
  clientName: string;
  contractName: string;
  contractUrl: string;
  programName?: string;
  dueDate?: string;
}

/** Which ClientFlow copy produced a welcome email, so any sent email can be traced back to it. */
export type WelcomeCopySource =
  /** The program's active CfProgramWelcomeEmailVersion. */
  | 'program_version'
  /** No active version: the program's own welcomeMessage override. */
  | 'program_message'
  /** No active version and no override: the generic ClientFlow welcome body. */
  | 'default'
  /** A program automation `send_email` rule. */
  | 'automation_rule';

export type WelcomeCopyMetadata = {
  source: WelcomeCopySource;
  templateId: string | null;
  templateName: string | null;
  versionId: string | null;
  versionNumber: number | null;
  /** Only for source `automation_rule`. */
  ruleId?: string | null;
};

/**
 * ClientFlow owns the client-facing welcome copy. `subject` and `body` are the fully resolved text
 * (variables already substituted) and `renderMode: 'verbatim'` tells n8n to send `body` as the
 * message with NO additional business wording before or after it. n8n supplies only the header
 * image, recipient, attachment, an optional fixed footer, and delivery.
 *
 * `nextStep` is the same text as `body`. It is kept only because the current n8n branch validates
 * it; new workflow logic should read `subject` and `body`. See docs/N8N_WELCOME_EMAIL.md.
 */
export interface WelcomeSendLifecyclePayload extends LifecycleEventBase {
  eventType: 'welcome.send';
  clientName: string;
  programName: string;
  subject: string;
  body: string;
  /** `body` as HTML paragraphs and line breaks, for the email's HTML part (`body` stays the text part). */
  bodyHtml: string;
  renderMode: 'verbatim';
  welcome: WelcomeCopyMetadata;
  nextStep: string;
  /** Short-lived download URL of the welcome guide. n8n downloads it and attaches the file. */
  attachmentUrl?: string;
  /** The guide's real filename, e.g. "IDI Member Welcome Guide.pdf". Only with attachmentUrl. */
  attachmentFileName?: string;
  /** The guide's MIME type, e.g. "application/pdf". Only with attachmentUrl. */
  attachmentMimeType?: string;
  headerImageUrl?: string;
}

/**
 * Emails a client the fully signed copy of their contract. Unlike contract.send this carries no
 * signing link: executedCopyUrl is a time-limited download URL for the executed document.
 * The matching n8n branch is specified in docs/N8N_CONTRACT_COPY.md.
 */
export interface ContractCopyLifecyclePayload extends LifecycleEventBase {
  eventType: 'contract.copy';
  contractId: string;
  enrollmentId?: string | null;
  clientName: string;
  programName: string;
  contractName: string;
  executedCopyUrl: string;
  source: 'automation' | 'manual_staff_action';
}

export type ClientflowLifecyclePayload =
  | FormSendLifecyclePayload
  | IntakeSendLifecyclePayload
  | ContractSendLifecyclePayload
  | WelcomeSendLifecyclePayload
  | ContractCopyLifecyclePayload;

export interface N8nDeliveryReceipt {
  success: true;
  status: 'SENT' | 'ACCEPTED';
  eventId: string;
  sentAt: string;
}

export interface IntakeEmailPayload {
  organizationId: string;
  clientId: string;
  formId: string;
  recipientEmail: string;
  clientName: string;
  formName: 'General Intake Form';
  formUrl: string;
  dueDate: string;
  expiresAt?: string | null;
  sentByUserId: string;
}

/** n8n answered with this HTTP status instead of accepting the event (e.g. `n8n_http_500`). */
export type N8nHttpFailureReason = `n8n_http_${number}`;

export type IntakeEmailDeliveryResult =
  | { status: 'sent'; sentAt: string }
  | { status: 'skipped'; reason: 'disabled' | 'not_configured' }
  | { status: 'failed'; reason: 'timeout' | 'rejected' | 'unavailable' | 'disabled' | 'not_configured' | N8nHttpFailureReason };

export interface ContractEmailPayload {
  organizationId: string;
  clientId: string;
  recipientEmail: string;
  clientName: string;
  programName?: string;
  contractName: string;
  contractUrl: string;
  dueDate?: string;
  sentByUserId: string;
}

export type ContractEmailDeliveryResult = IntakeEmailDeliveryResult;

export interface WelcomeEmailPayload {
  organizationId: string;
  clientId: string;
  recipientEmail: string;
  clientName: string;
  programName: string;
  /** The resolved subject, exactly as it should read. */
  subject: string;
  /** The resolved body, exactly as it should read. Sent as-is; n8n adds no wording around it. */
  body: string;
  renderMode: 'verbatim';
  /** Which ClientFlow copy this came from (template/version ids), for tracing. */
  welcome: WelcomeCopyMetadata;
  /** Same text as `body`; kept for the current n8n validation. */
  nextStep: string;
  attachmentUrl?: string;
  attachmentFileName?: string;
  attachmentMimeType?: string;
  /** Public URL of the org's header logo; resolved independently of the guide attachment. */
  headerImageUrl?: string;
  sentByUserId: string;
}

export type WelcomeEmailDeliveryResult = IntakeEmailDeliveryResult;

export type ContractCopyEmailPayload = Omit<ContractCopyLifecyclePayload, 'eventType' | 'eventId' | 'occurredAt'>;

export type ContractCopyEmailDeliveryResult = IntakeEmailDeliveryResult;
