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
  contractSent: 'CONTRACT_SENT',
} as const;

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
} as const;

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
    LEGAL_TEMPLATE_DISCLAIMER,
  ].join('\n');
}
