import { attachmentDisposition } from '../../integrations/storage/storage.service';
import type { StorageService } from '../../integrations/storage/storage.service';
import type { PrismaService } from '../../prisma/prisma.service';
import { executedCopyFileName, organizationLogoImage } from './executed-contract-file';
import { isPdfEmbeddableImage, renderExecutedContractPdf } from './executed-contract-pdf';
import { renderContractSnapshot } from './contract-lifecycle';

/** A 1×1 PNG. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);
const WEBP = Buffer.from('RIFF\x00\x00\x00\x00WEBPVP8 ', 'latin1');
const imageCount = (pdf: Buffer) => pdf.toString('latin1').match(/\/Subtype \/Image/g)?.length ?? 0;

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

describe('the organization logo on the signed copy', () => {
  it('draws a PNG logo above the title', async () => {
    const pdf = await renderExecutedContractPdf({ title: 'Award Agreement', body: 'Body.', headerImage: PNG, compress: false });
    expect(imageCount(pdf)).toBeGreaterThan(0);
  });

  it('leaves out a logo PDFKit cannot draw, or a damaged one, and still produces the copy', async () => {
    const webp = await renderExecutedContractPdf({ title: 'Award Agreement', body: 'Body.', headerImage: WEBP, compress: false });
    expect(imageCount(webp)).toBe(0);
    const damaged = Buffer.concat([PNG.subarray(0, 8), Buffer.from('not really a png')]);
    const broken = await renderExecutedContractPdf({ title: 'Award Agreement', body: 'Body.', headerImage: damaged, compress: false });
    expect(broken.subarray(0, 5).toString()).toBe('%PDF-');
    expect(isPdfEmbeddableImage(WEBP)).toBe(false);
    expect(isPdfEmbeddableImage(PNG)).toBe(true);
  });

  function logoContext(file: Record<string, unknown> | null, bytes: Buffer | null, settings: unknown = { logoStoredFileId: 'logo-1' }) {
    const prisma = {
      organization: { findUnique: jest.fn().mockResolvedValue({ settings }) },
      cfStoredFile: { findFirst: jest.fn().mockResolvedValue(file) },
    };
    const storage = { isEnabled: () => true, readObjectStart: jest.fn().mockResolvedValue(bytes) };
    return { prisma, storage, read: () => organizationLogoImage(prisma as unknown as PrismaService, storage as unknown as StorageService, 'org-1') };
  }

  it("reads the Settings logo from its bucket, scoped to the organization", async () => {
    const { prisma, storage, read } = logoContext({ storageKey: 'organization/header-logo/a.png', storageBucket: 'public', sizeBytes: PNG.length }, PNG);
    await expect(read()).resolves.toEqual(PNG);
    expect(prisma.cfStoredFile.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'logo-1', organizationId: 'org-1', status: 'READY' } }));
    expect(storage.readObjectStart).toHaveBeenCalledWith('public', 'organization/header-logo/a.png', PNG.length);
  });

  it('gives no logo when none is set, it is too large, another format, or unreadable', async () => {
    await expect(logoContext(null, PNG, {}).read()).resolves.toBeNull();
    await expect(logoContext({ storageKey: 'k', storageBucket: 'public', sizeBytes: 3 * 1024 * 1024 }, PNG).read()).resolves.toBeNull();
    await expect(logoContext({ storageKey: 'k', storageBucket: 'public', sizeBytes: 20 }, WEBP).read()).resolves.toBeNull();
    const failing = logoContext({ storageKey: 'k', storageBucket: 'public', sizeBytes: 20 }, null);
    failing.storage.readObjectStart.mockRejectedValue(new Error('network'));
    await expect(failing.read()).resolves.toBeNull();
  });
});

describe('the agreement text the client signs', () => {
  it("ends with the organization's signature, without internal record ids", () => {
    const text = renderContractSnapshot({
      templateContent: 'Award of $500.00 to Corner Coffee LLC.',
      staffSignerName: 'Jordan Lee',
      staffSignedAt: new Date('2026-11-19T22:27:06.427Z'),
    });
    expect(text).toBe('Award of $500.00 to Corner Coffee LLC.\n\nSIGNED FOR THE ORGANIZATION\nSigned by: Jordan Lee\nSigned at: 2026-11-19 22:27 UTC');
    expect(text).not.toMatch(/ID:|GENERATED CONTRACT SNAPSHOT/);
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
