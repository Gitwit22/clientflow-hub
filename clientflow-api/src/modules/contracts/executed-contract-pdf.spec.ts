import { renderExecutedContractPdf } from './executed-contract-pdf';

describe('renderExecutedContractPdf', () => {
  it('produces a PDF document for the executed contract', async () => {
    const pdf = await renderExecutedContractPdf({
      title: 'Service Agreement - Executed',
      content: ['Terms of service.', '', 'CLIENT ACCEPTANCE', 'Signed by: Client Owner'].join('\n'),
    });

    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(pdf.subarray(-6).toString('latin1')).toContain('%%EOF');
  });

  it('paginates long contracts and tolerates characters the built-in fonts cannot draw', async () => {
    const longContent = Array.from({ length: 400 }, (_, i) => `Clause ${i + 1} — “quoted” terms … \u{1F600}`).join('\n');

    const pdf = await renderExecutedContractPdf({ title: 'Long Agreement - Executed', content: longContent });

    const pageCount = (pdf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length;
    expect(pageCount).toBeGreaterThan(1);
  });
});
