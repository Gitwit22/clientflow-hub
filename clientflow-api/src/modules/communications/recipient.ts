import { BadRequestException } from '@nestjs/common';

// Deliberately simple: one @, no spaces, a dot in the domain. Catches blanks and typos
// ("jane@gmail", "jane gmail.com") that would otherwise fail inside the email workflow.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isSendableEmail(email: string | null | undefined): boolean {
  return typeof email === 'string' && EMAIL_PATTERN.test(email.trim());
}

/**
 * Checked before a staff-triggered email, so a missing name or bad address is a clear message on
 * the spot instead of a failed delivery (and a "Hi ," greeting) recorded against the client.
 */
export function assertSendableRecipient(recipient: { email: string | null | undefined; name: string | null | undefined }): void {
  if (!isSendableEmail(recipient.email)) {
    throw new BadRequestException(
      recipient.email?.trim()
        ? `"${recipient.email.trim()}" is not a valid email address. Correct it on the client before sending.`
        : 'Add an email address to this client before sending.',
    );
  }
  if (!recipient.name?.trim()) {
    throw new BadRequestException("Add the client's contact name before sending.");
  }
}
