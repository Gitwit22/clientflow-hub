import PDFDocument from 'pdfkit';

export interface ExecutedContractAcceptance {
  signedName: string;
  signedEmail: string;
  signedAt: Date;
  note?: string | null;
}

export interface ExecutedContractPdfInput {
  title: string;
  body: string;
  acceptance?: ExecutedContractAcceptance;
  /** Test hook: uncompressed streams keep the rendered text greppable. */
  compress?: boolean;
}

const MARGIN = 64;

// The built-in PDF fonts only cover WinAnsi; map common typography and drop anything else
// so an unusual character can never break the render.
const WIN_ANSI_EXTRAS = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ');
function toWinAnsi(text: string): string {
  return Array.from(text.normalize('NFC'))
    .map((char) => {
      const code = char.codePointAt(0) ?? 0;
      if (char === '\n') return char;
      if (char === '\t') return '    ';
      if (code === 0x2212 || code === 0x2010 || code === 0x2011) return '-';
      if (code === 0x00a0 || code === 0x202f) return ' ';
      if ((code >= 0x20 && code <= 0x7e) || (code >= 0xa1 && code <= 0xff) || WIN_ANSI_EXTRAS.has(char)) {
        return char;
      }
      return '';
    })
    .join('');
}

/** Section headings in the stored agreement are all-caps lines, optionally numbered ("1. PURPOSE"). */
function isHeading(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length < 3 || trimmed.length > 90) return false;
  const letters = trimmed.replace(/[^A-Za-z]/g, '');
  return letters.length >= 3 && letters === letters.toUpperCase();
}

function formatSignedAt(date: Date): string {
  return `${date.toISOString().replace('T', ' ').slice(0, 16)} UTC`;
}

export function renderExecutedContractPdf(input: ExecutedContractPdfInput): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'LETTER',
    margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
    bufferPages: true,
    compress: input.compress ?? true,
    info: { Title: toWinAnsi(input.title), Subject: 'Executed agreement', Creator: 'ClientFlow' },
  });
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const width = doc.page.width - MARGIN * 2;

  doc.font('Helvetica-Bold').fontSize(16).text(toWinAnsi(input.title), { width, align: 'center' });
  doc.moveDown(0.3);
  doc.font('Helvetica').fontSize(9).fillColor('#555555').text('Executed copy', { width, align: 'center' });
  doc.fillColor('#000000').moveDown(1.2);

  const lines = toWinAnsi(input.body).replace(/\r\n?/g, '\n').split('\n');
  // The title is already the heading; don't print it twice.
  if (lines[0]?.trim().toLowerCase() === toWinAnsi(input.title).trim().toLowerCase()) lines.shift();
  for (const line of lines) {
    if (!line.trim()) {
      doc.moveDown(0.6);
    } else if (isHeading(line)) {
      doc.moveDown(0.3).font('Helvetica-Bold').fontSize(11).text(line.trim(), { width });
      doc.moveDown(0.2);
    } else {
      doc.font('Helvetica').fontSize(10).text(line, { width, lineGap: 2 });
    }
  }

  if (input.acceptance) {
    const { signedName, signedEmail, signedAt, note } = input.acceptance;
    const rows: Array<[string, string]> = [
      ['Signed by', signedName],
      ['Email', signedEmail],
      ['Signed at', formatSignedAt(signedAt)],
    ];
    if (note?.trim()) rows.push(['Note', note.trim()]);

    const boxHeight = 34 + rows.length * 16;
    doc.moveDown(1.2);
    if (doc.y + boxHeight > doc.page.height - MARGIN) doc.addPage();
    const top = doc.y;
    doc.rect(MARGIN, top, width, boxHeight).lineWidth(0.8).strokeColor('#999999').stroke();
    doc.font('Helvetica-Bold').fontSize(11).text('Client acceptance', MARGIN + 12, top + 10, { width: width - 24 });
    let y = top + 30;
    for (const [label, value] of rows) {
      doc.font('Helvetica-Bold').fontSize(10).text(`${label}:`, MARGIN + 12, y, { width: 80 });
      doc.font('Helvetica').fontSize(10).text(toWinAnsi(value), MARGIN + 96, y, { width: width - 108 });
      y += 16;
    }
    doc.x = MARGIN;
    doc.y = top + boxHeight;
  }

  const range = doc.bufferedPageRange();
  for (let index = range.start; index < range.start + range.count; index += 1) {
    doc.switchToPage(index);
    // Drop the bottom margin while writing the footer so it doesn't spill onto a new page.
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor('#777777')
      .text(`Page ${index - range.start + 1} of ${range.count}`, MARGIN, doc.page.height - MARGIN / 2, {
        width,
        align: 'center',
      });
    doc.page.margins.bottom = bottom;
  }

  doc.end();
  return done;
}
