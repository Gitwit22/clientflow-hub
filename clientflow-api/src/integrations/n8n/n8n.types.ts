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
  recipientEmail?: string;
  clientName?: string;
  programName?: string;
  formName?: string;
  formUrl?: string;
  contractName?: string;
  contractUrl?: string;
  dueDate?: string;
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
