export type ClientflowLifecycleEventType =
  | 'form.send'
  | 'intake.send'
  | 'contract.send'
  | 'welcome.send'
  | 'form.submitted'
  | 'contract.completed'
  | 'email.status';

export interface ClientflowLifecyclePayload {
  eventId: string;
  eventType: ClientflowLifecycleEventType;
  organizationId: string;
  clientId: string;
  formId?: string;
  recipientEmail?: string;
  clientName?: string;
  programName?: string;
  formName?: string;
  formUrl?: string;
  contractName?: string;
  contractUrl?: string;
  dueDate?: string;
  expiresAt?: string | null;
  sentByUserId?: string;
  personalMessage?: string;
  nextStep?: string;
  occurredAt: string;
}

export interface N8nDeliveryReceipt {
  success: true;
  status: 'SENT' | 'ACCEPTED';
  eventId: string;
  sentAt: string;
}

export interface IntakeEmailPayload {
  eventType: 'intake.send';
  organizationId: string;
  clientId: string;
  recipientEmail: string;
  clientName: string;
  formName: 'General Intake Form';
  formUrl: string;
  dueDate: string;
}

export type IntakeEmailDeliveryResult =
  | { status: 'sent'; sentAt: string }
  | { status: 'skipped'; reason: 'disabled' | 'not_configured' }
  | { status: 'failed'; reason: 'timeout' | 'rejected' | 'unavailable' };

export interface ContractEmailPayload {
  eventType: 'contract.send';
  organizationId: string;
  clientId: string;
  recipientEmail: string;
  clientName: string;
  programName: string;
  contractName: string;
  contractUrl: string;
  dueDate: string;
}

export type ContractEmailDeliveryResult = IntakeEmailDeliveryResult;

export interface WelcomeEmailPayload {
  eventType: 'welcome.send';
  organizationId: string;
  clientId: string;
  recipientEmail: string;
  clientName: string;
  programName: string;
  nextStep: string;
}

export type WelcomeEmailDeliveryResult = IntakeEmailDeliveryResult;
