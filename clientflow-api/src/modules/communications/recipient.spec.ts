import { BadRequestException } from '@nestjs/common';
import { assertSendableRecipient, isSendableEmail } from './recipient';

describe('recipient checks', () => {
  it('accepts ordinary addresses and rejects blanks and typos', () => {
    expect(isSendableEmail('pat@example.com')).toBe(true);
    expect(isSendableEmail(' pat@example.co.uk ')).toBe(true);
    for (const bad of [null, '', 'pat@example', 'pat example.com', 'pat@@x.com']) {
      expect(isSendableEmail(bad)).toBe(false);
    }
  });

  it('names what is missing', () => {
    expect(() => assertSendableRecipient({ email: '', name: 'Pat' })).toThrow('Add an email address');
    expect(() => assertSendableRecipient({ email: 'pat@example', name: 'Pat' })).toThrow('"pat@example" is not a valid email');
    expect(() => assertSendableRecipient({ email: 'pat@example.com', name: ' ' })).toThrow(BadRequestException);
    expect(() => assertSendableRecipient({ email: 'pat@example.com', name: 'Pat' })).not.toThrow();
  });
});
