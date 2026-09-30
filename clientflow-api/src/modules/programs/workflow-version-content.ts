import { BadRequestException } from '@nestjs/common';

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
