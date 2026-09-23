export type ClientflowLifecycleEventType =
  | 'form.send'
  | 'contract.send'
  | 'welcome.send'
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
  formPurpose?: 'manual' | 'general_intake';
}

export interface ContractSendLifecyclePayload extends LifecycleEventBase {
  eventType: 'contract.send';
  clientName: string;
  contractName: string;
  contractUrl: string;
  programName?: string;
  dueDate?: string;
}

export interface WelcomeSendLifecyclePayload extends LifecycleEventBase {
  eventType: 'welcome.send';
  clientName: string;
  programName: string;
  nextStep: string;
  attachmentUrl?: string;
}

export type ClientflowLifecyclePayload =
  | FormSendLifecyclePayload
  | ContractSendLifecyclePayload
  | WelcomeSendLifecyclePayload;

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

export type IntakeEmailDeliveryResult =
  | { status: 'sent'; sentAt: string }
  | { status: 'skipped'; reason: 'disabled' | 'not_configured' }
  | { status: 'failed'; reason: 'timeout' | 'rejected' | 'unavailable' };

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
  nextStep: string;
  attachmentUrl?: string;
  sentByUserId: string;
}

export type WelcomeEmailDeliveryResult = IntakeEmailDeliveryResult;
