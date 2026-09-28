import { attachmentDisposition } from '../../integrations/storage/storage.service';
import { executedCopyFileName } from './executed-contract-file';
import { renderExecutedContractPdf } from './executed-contract-pdf';

const body = [
  'INSPIRED DETROIT INITIATIVE MEMBERSHIP AGREEMENT',
  '',
  '1. PURPOSE OF IDI',
  'The Inspired Detroit Initiative helps Detroit founders — with “quotes” and an emoji 🎉.',
  ...Array.from({ length: 120 }, (_, index) => `Clause line ${index + 1} of the agreement.`),
].join('\n');

describe('renderExecutedContractPdf', () => {
  it('renders a multi-page PDF from a long body with odd characters', async () => {
    const pdf = await renderExecutedContractPdf({
      title: 'Membership Agreement',
      body,
      acceptance: {
        signedName: 'Neal Pope',
        signedEmail: 'neal@example.com',
        signedAt: new Date('2026-09-28T15:04:00Z'),
        note: 'Looking forward to it',
      },
      compress: false,
    });
    const raw = pdf.toString('latin1');

    expect(raw.startsWith('%PDF-')).toBe(true);
    expect(raw.match(/\/Type \/Page\b/g)?.length).toBeGreaterThan(1);
  });

  it('renders without an acceptance block', async () => {
    const pdf = await renderExecutedContractPdf({ title: 'Agreement', body: 'Short body.' });
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  });
});

describe('executed copy file name', () => {
  it('names the download after the client and contract, without unsafe characters', () => {
    expect(executedCopyFileName('Keep it Moving Construction LLC', 'Membership Agreement')).toBe(
      'Keep it Moving Construction LLC - Membership Agreement - Signed.pdf',
    );
    expect(executedCopyFileName('A/B "Co"', 'Deal')).toBe('A B Co - Deal - Signed.pdf');
    expect(executedCopyFileName(null, 'Deal')).toBe('Deal - Signed.pdf');
  });

  it('builds an attachment disposition with an ASCII fallback and a UTF-8 name', () => {
    expect(attachmentDisposition('Café - Signed.pdf')).toBe(
      `attachment; filename="Caf - Signed.pdf"; filename*=UTF-8''Caf%C3%A9%20-%20Signed.pdf`,
    );
  });
});
