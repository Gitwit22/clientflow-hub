import { BadRequestException } from '@nestjs/common';
import { type AgreementPurpose, templateFieldProblemMessage } from '../contracts/merge-fields';

/**
 * Subject and body of a new welcome email version. Neither may be blank: the active version is
 * what clients receive, and a blank one would send an empty welcome email.
 */
export function welcomeVersionContent(body: Record<string, unknown>): { subject: string; body: string } {
  const programName = typeof body.programName === 'string' && body.programName ? body.programName : 'the program';
  const subject = (typeof body.subject === 'string' ? body.subject : `Welcome to ${programName}`).trim();
  const text = (typeof body.body === 'string' ? body.body : '').trim();
  if (!subject) throw new BadRequestException('The welcome email needs a subject.');
  if (!text) throw new BadRequestException('The welcome email needs a message.');
  return { subject, body: text };
}

/** A contract version needs its text or an uploaded document; otherwise clients sign a blank page. */
export function assertContractVersionContent(body: Record<string, unknown>): void {
  const hasText = typeof body.content === 'string' && body.content.trim().length > 0;
  const hasFile = Boolean(body.storedFileId || body.fileUrl);
  if (!hasText && !hasFile) {
    throw new BadRequestException('Add the contract text or upload the contract document.');
  }
}

/**
 * The merge fields in a new agreement version must exist and suit the template's purpose (award
 * fields only in award agreements), so a typo is caught when staff save, not when a client signs.
 */
export function assertAgreementMergeFields(body: Record<string, unknown>, purpose: AgreementPurpose): void {
  const content = typeof body.content === 'string' ? body.content : '';
  const title = typeof body.title === 'string' ? body.title : '';
  const problem = templateFieldProblemMessage(`${title}\n${content}`, purpose);
  if (problem) throw new BadRequestException(problem);
}
