import PDFDocument from 'pdfkit';

/**
 * Renders the executed (fully signed) contract as a PDF so clients receive a document that opens
 * on any phone or browser. The text is laid out exactly as stored; pdfkit handles wrapping and
 * page breaks. Lines in ALL CAPS (the snapshot's section headings) are set in bold.
 */
export function renderExecutedContractPdf(input: { title: string; content: string }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'LETTER',
      margin: 72,
      info: { Title: input.title },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.font('Helvetica-Bold').fontSize(16).text(input.title, { align: 'center' });
    doc.moveDown(1.5);

    for (const line of toPdfSafeText(input.content).split('\n')) {
      if (!line.trim()) {
        doc.moveDown(0.6);
        continue;
      }
      const heading = /[A-Z]/.test(line) && line === line.toUpperCase();
      doc.font(heading ? 'Helvetica-Bold' : 'Helvetica').fontSize(heading ? 11.5 : 10.5).text(line, {
        align: 'left',
        lineGap: 2,
      });
    }

    doc.end();
  });
}

// The built-in PDF fonts only cover WinAnsi (Latin-1 plus common punctuation). Map typographic
// characters to their plain equivalents and drop anything else rather than print garbage glyphs.
function toPdfSafeText(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, '    ')
    .replace(/[\u2018\u2019\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201F]/g, '"')
    .replace(/[\u2013\u2014\u2212]/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/[\u2022\u25CF\u25AA]/g, '-')
    .replace(/\u00A0/g, ' ')
    .replace(/[^\n\x20-\x7E\u00A1-\u00FF]/g, '');
}
