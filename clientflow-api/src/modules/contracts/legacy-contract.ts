import type { Prisma } from '../../generated/clientflow';

/** First line of the drafts the old in-browser contract builder produced. */
export const LEGACY_CONTRACT_HEADER = 'DRAFT AGREEMENT — NOT FINAL LEGAL LANGUAGE';

/**
 * Contracts from before program contract templates: the browser built the text itself (leaving
 * `{{placeholders}}` for anything missing) and saved it with no template and no staff signature.
 * Every contract the workflow generates has a template and is staff-signed when it is created, so
 * these can never be mistaken for a real one. They must never be sent for signature or count as
 * the enrollment's contract.
 */
export const LEGACY_CONTRACT_WHERE = {
  staffSignedAt: null,
  OR: [{ contractTemplateId: '' }, { generatedContent: { startsWith: LEGACY_CONTRACT_HEADER } }],
} satisfies Prisma.CfContractWhereInput;

export const NOT_LEGACY_CONTRACT = { NOT: LEGACY_CONTRACT_WHERE } satisfies Prisma.CfContractWhereInput;

export function isLegacyContract(contract: {
  staffSignedAt?: Date | string | null;
  contractTemplateId?: string | null;
  generatedContent?: string | null;
}): boolean {
  return !contract.staffSignedAt
    && (contract.contractTemplateId === '' || (contract.generatedContent ?? '').startsWith(LEGACY_CONTRACT_HEADER));
}

/**
 * Excludes legacy contracts the client never signed. A legacy draft that was sent through the real
 * signing link and signed is still a signed agreement, so it keeps counting where "signed" matters.
 */
export const NOT_UNSIGNED_LEGACY_CONTRACT = {
  NOT: { ...LEGACY_CONTRACT_WHERE, completedAt: null },
} satisfies Prisma.CfContractWhereInput;
