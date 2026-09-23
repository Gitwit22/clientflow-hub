import { createHash, randomBytes } from 'node:crypto';

export const CONTRACT_STATUS = {
  draft: 'DRAFT',
  sent: 'SENT',
  opened: 'OPENED',
  completed: 'COMPLETED',
  cancelled: 'CANCELLED',
  expired: 'EXPIRED',
} as const;

export const CONTRACT_CLIENT_STATUS = {
  pendingStaffReview: 'PENDING_STAFF_REVIEW',
  reviewDeclined: 'REVIEW_DECLINED',
  contractSent: 'CONTRACT_SENT',
  contractOpened: 'CONTRACT_OPENED',
  onboarding: 'ONBOARDING',
} as const;

export const MONITORING_TASK_STATUS = {
  pending: 'PENDING',
  completed: 'COMPLETED',
  overdue: 'OVERDUE',
  cancelled: 'CANCELLED',
} as const;

export const INITIAL_FOLLOW_UP_TYPE = 'Initial Follow-Up';
export const WELCOME_NEXT_STEP =
  'Your onboarding has started. A team member will follow up with you soon.';

export const LEGAL_TEMPLATE_DISCLAIMER =
  'Template draft only. Final legal language must be reviewed by the organization before use.';

export const PROGRAM_CONTRACT_RULES = {
  'Brand Awareness Subscription': 'auto_contract',
  '30-Day Premier Workshop Subscription': 'auto_contract',
  'Event Planning': 'staff_review',
  'Commercial Property': 'staff_review',
  Grant: 'staff_review',
  Sponsorship: 'staff_review',
  Interest: 'staff_review',
  'Other / Unsure': 'staff_review',
  'The Inspired Detroit Initiative': 'auto_contract',
} as const;

export const PROGRAM_CONTRACT_TEMPLATES = {
  'Brand Awareness Subscription': 'Brand Awareness Service Agreement',
  '30-Day Premier Workshop Subscription': 'Premier Workshop Service Agreement',
  'Event Planning': 'Event Planning Agreement',
  'Commercial Property': 'Commercial Property Service Agreement',
  Grant: 'Grant Agreement',
  Sponsorship: 'Sponsorship Agreement',
  Interest: 'General Services Agreement',
  'Other / Unsure': 'General Services Agreement',
  'The Inspired Detroit Initiative': 'IDI Membership Agreement',
} as const;

/** Per-program welcome email copy; programs not listed fall back to WELCOME_NEXT_STEP. */
export const PROGRAM_WELCOME_MESSAGES: Partial<Record<string, string>> = {
  'The Inspired Detroit Initiative':
    'Hi {{client.firstName}},\n\n'
    + 'Welcome to The Inspired Detroit Initiative.\n\n'
    + 'Your agreement has been received and your enrollment is now moving into onboarding.\n\n'
    + "We've attached your Welcome Guide, which explains the program, what to expect, and your next steps.\n\n"
    + '[View Welcome Guide]\n\n'
    + 'EA Management',
};

const IDI_WELCOME_GUIDE_PATH = '/contracts and emails/IDI Member Welcome Guide.pdf';

export function welcomeMessageFor(
  programName: string,
  appUrl?: string,
  welcomeMessageOverride?: string | null,
): string {
  const message = welcomeMessageOverride?.trim() || PROGRAM_WELCOME_MESSAGES[programName] || WELCOME_NEXT_STEP;
  if (programName === 'The Inspired Detroit Initiative' && appUrl && !welcomeMessageOverride?.trim()) {
    const guideUrl = `${appUrl.replace(/\/+$/, '')}${encodeURI(IDI_WELCOME_GUIDE_PATH)}`;
    return `${message} IDI Member Welcome Guide: ${guideUrl}`;
  }
  return message;
}

/** Public URL of the program's welcome-email attachment, for n8n to fetch and attach to the send. */
export function welcomeAttachmentUrlFor(programName: string, appUrl?: string): string | undefined {
  if (programName !== 'The Inspired Detroit Initiative' || !appUrl) return undefined;
  return `${appUrl.replace(/\/+$/, '')}${encodeURI(IDI_WELCOME_GUIDE_PATH)}`;
}

export type ContractProgramName = keyof typeof PROGRAM_CONTRACT_RULES;
export type ContractRule = typeof PROGRAM_CONTRACT_RULES[ContractProgramName];

export function contractRuleFor(programName: string): ContractRule | null {
  return programName in PROGRAM_CONTRACT_RULES
    ? PROGRAM_CONTRACT_RULES[programName as ContractProgramName]
    : null;
}

export function contractTemplateNameFor(programName: string): string | null {
  return programName in PROGRAM_CONTRACT_TEMPLATES
    ? PROGRAM_CONTRACT_TEMPLATES[programName as ContractProgramName]
    : null;
}

export function generateContractToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashContractToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function contractTokenExpiry(from: Date): Date {
  return new Date(from.getTime() + 7 * 86_400_000);
}

export function monitoringDueDate(from: Date, frequency: string): Date {
  const daysByFrequency: Record<string, number> = {
    weekly: 7,
    biweekly: 14,
    monthly: 30,
    quarterly: 90,
  };
  const days = daysByFrequency[frequency.trim().toLowerCase()] ?? 7;
  return new Date(from.getTime() + days * 86_400_000);
}

export function contractTemplateId(organizationId: string, templateName: string): string {
  return `cftpl_${createHash('md5').update(`${organizationId}:${templateName}`).digest('hex')}`;
}

export function renderContractSnapshot(input: {
  templateName: string;
  templateContent: string;
  clientId: string;
  clientName: string;
  programId: string;
  programName: string;
  generatedAt: Date;
  staffSignerName: string;
  staffSignedAt: Date;
}): string {
  return [
    input.templateContent,
    '',
    'GENERATED CONTRACT SNAPSHOT',
    `Contract template: ${input.templateName}`,
    `Client: ${input.clientName}`,
    `Client ID: ${input.clientId}`,
    `Program: ${input.programName}`,
    `Program ID: ${input.programId}`,
    `Generated at: ${input.generatedAt.toISOString()}`,
    '',
    'SIGNED FOR THE ORGANIZATION',
    `Signed by: ${input.staffSignerName}`,
    `Signed at: ${input.staffSignedAt.toISOString()}`,
    '',
    LEGAL_TEMPLATE_DISCLAIMER,
  ].join('\n');
}
