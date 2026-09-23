export type ClientflowLifecycleEventType =
  | 'form.send'
  | 'form.submitted'
  | 'contract.completed'
  | 'email.status';

export interface ClientflowLifecyclePayload {
  eventId: string;
  eventType: ClientflowLifecycleEventType;
  organizationId: string;
  clientId: string;
  formId: string;
  recipientEmail?: string;
  clientName?: string;
  programName?: string;
  formName?: string;
  formUrl?: string;
  contractName?: string;
  contractUrl?: string;
  dueDate?: string;
  expiresAt?: string | null;
  sentByUserId: string;
  personalMessage?: string;
  nextStep?: string;
  /** Distinguishes automated form.send events (general_intake, contract, welcome) that carry no manual sender. */
  formPurpose?: 'manual' | 'general_intake' | 'contract' | 'welcome';
  occurredAt: string;
}

export interface N8nDeliveryReceipt {
  success: true;
  status: 'SENT' | 'ACCEPTED';
  eventId: string;
  sentAt: string;
}

// n8n's webhook validator only accepts eventType 'form.send' and requires formId, formName, formUrl,
// and sentByUserId,
// so every lifecycle email - including the auto-generated General Intake - must be sent as a
// form.send event; the previously separate intake.send/contract.send/welcome.send types were rejected.
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

export type IntakeEmailDeliveryResult =
  | { status: 'sent'; sentAt: string }
  | { status: 'skipped'; reason: 'disabled' | 'not_configured' }
  | { status: 'failed'; reason: 'timeout' | 'rejected' | 'unavailable' };

export interface ContractEmailPayload {
  organizationId: string;
  clientId: string;
  formId: string;
  recipientEmail: string;
  clientName: string;
  programName: string;
  formName: string;
  formUrl: string;
  contractName: string;
  contractUrl: string;
  dueDate: string;
  sentByUserId: string;
}

export type ContractEmailDeliveryResult = IntakeEmailDeliveryResult;

export interface WelcomeEmailPayload {
  organizationId: string;
  clientId: string;
  formId: string;
  recipientEmail: string;
  clientName: string;
  programName: string;
  nextStep: string;
  emailSubject?: string;
  emailBody?: string;
  sentByUserId: string;
}

export type WelcomeEmailDeliveryResult = IntakeEmailDeliveryResult;
