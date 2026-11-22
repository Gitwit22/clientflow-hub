import PDFDocument from 'pdfkit';
import { agreementPlainText, parseAgreementText, type AgreementBlock, type AgreementRun } from './agreement-format';

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
  /** The organization's header logo (PNG or JPEG), drawn above the title. Anything else is skipped. */
  headerImage?: Buffer | null;
  /** Test hook: uncompressed streams keep the rendered text greppable. */
  compress?: boolean;
}

// One-inch margins and 12pt text, so the signed copy reads comfortably on paper and on screen.
const MARGIN = 72;
const BODY_SIZE = 12;
const SIZE_BY_KIND: Record<AgreementBlock['kind'], number> = {
  heading: 16,
  subheading: 13.5,
  small: 9.5,
  paragraph: BODY_SIZE,
  bullet: BODY_SIZE,
  numbered: BODY_SIZE,
  blank: BODY_SIZE,
};
const LIST_INDENT = 18;
const LOGO_MAX_WIDTH = 180;
const LOGO_MAX_HEIGHT = 60;

/** PDFKit draws only PNG and JPEG; recognise them by their first bytes, not a declared type. */
export function isPdfEmbeddableImage(bytes: Buffer | null | undefined): bytes is Buffer {
  if (!bytes || bytes.length < 4) return false;
  const png = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  return png || jpeg;
}

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

function fontFor(run: AgreementRun, forceBold: boolean): string {
  const bold = forceBold || run.bold;
  if (bold && run.italic) return 'Helvetica-BoldOblique';
  if (bold) return 'Helvetica-Bold';
  if (run.italic) return 'Helvetica-Oblique';
  return 'Helvetica';
}

/** One line of the agreement (agreement-format.ts markup): sizes, bold, italic, underline, lists, centering. */
function drawBlock(doc: PDFKit.PDFDocument, block: AgreementBlock, width: number): void {
  if (block.kind === 'blank') {
    doc.moveDown(0.6);
    return;
  }
  const runs = block.runs
    .map((run) => ({ ...run, text: toWinAnsi(run.text) }))
    .filter((run) => run.text.length > 0);
  if (!runs.length) return;
  const size = SIZE_BY_KIND[block.kind];
  const isHeading = block.kind === 'heading' || block.kind === 'subheading';
  if (isHeading) doc.moveDown(block.kind === 'heading' ? 0.5 : 0.35);
  const isList = block.kind === 'bullet' || block.kind === 'numbered';
  const left = MARGIN + (isList ? LIST_INDENT : 0);
  const textWidth = width - (isList ? LIST_INDENT : 0);
  const top = doc.y;
  doc.fillColor(block.kind === 'small' ? '#444444' : '#000000');
  if (isList) {
    doc.font('Helvetica').fontSize(size).text(block.kind === 'bullet' ? '•' : toWinAnsi(block.marker ?? ''), MARGIN, top, {
      width: LIST_INDENT,
      lineBreak: false,
    });
  }
  runs.forEach((run, index) => {
    const options = {
      width: textWidth,
      align: block.center ? ('center' as const) : ('left' as const),
      lineGap: block.kind === 'small' ? 1 : 3,
      underline: Boolean(run.underline),
      continued: index < runs.length - 1,
    };
    doc.font(fontFor(run, isHeading)).fontSize(size);
    if (index === 0) doc.text(run.text, left, top, options);
    else doc.text(run.text, options);
  });
  doc.fillColor('#000000');
  doc.x = MARGIN;
  if (isHeading) doc.moveDown(0.25);
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

  if (isPdfEmbeddableImage(input.headerImage)) {
    try {
      const top = doc.y;
      // The logo is scaled to fit a box centred on the page.
      doc.image(input.headerImage, (doc.page.width - LOGO_MAX_WIDTH) / 2, top, {
        fit: [LOGO_MAX_WIDTH, LOGO_MAX_HEIGHT],
        align: 'center',
        valign: 'center',
      });
      doc.x = MARGIN;
      doc.y = top + LOGO_MAX_HEIGHT + 16;
    } catch {
      // A damaged image never stops the signed copy from being produced.
    }
  }

  doc.font('Helvetica-Bold').fontSize(18).text(toWinAnsi(input.title), { width, align: 'center' });
  doc.moveDown(0.3);
  doc.font('Helvetica').fontSize(10).fillColor('#555555').text('Executed copy', { width, align: 'center' });
  doc.fillColor('#000000').moveDown(1.2);

  const blocks = parseAgreementText(input.body);
  // The title is already the heading; don't print it twice.
  const firstLine = agreementPlainText(input.body.replace(/\r\n?/g, '\n').split('\n')[0] ?? '');
  if (firstLine.trim().toLowerCase() === input.title.trim().toLowerCase()) blocks.shift();
  for (const block of blocks) drawBlock(doc, block, width);

  if (input.acceptance) {
    const { signedName, signedEmail, signedAt, note } = input.acceptance;
    const rows: Array<[string, string]> = [
      ['Signed by', signedName],
      ['Email', signedEmail],
      ['Signed at', formatSignedAt(signedAt)],
    ];
    if (note?.trim()) rows.push(['Note', note.trim()]);

    const boxHeight = 36 + rows.length * 18;
    doc.moveDown(1.2);
    if (doc.y + boxHeight > doc.page.height - MARGIN) doc.addPage();
    const top = doc.y;
    doc.rect(MARGIN, top, width, boxHeight).lineWidth(0.8).strokeColor('#999999').stroke();
    doc.font('Helvetica-Bold').fontSize(12).text('Client acceptance', MARGIN + 12, top + 10, { width: width - 24 });
    let y = top + 32;
    for (const [label, value] of rows) {
      doc.font('Helvetica-Bold').fontSize(11).text(`${label}:`, MARGIN + 12, y, { width: 80 });
      doc.font('Helvetica').fontSize(11).text(toWinAnsi(value), MARGIN + 96, y, { width: width - 108 });
      y += 18;
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
