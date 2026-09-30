import { BadRequestException } from '@nestjs/common';

/** Largest file staff can upload. Contracts, guides and client documents are well under this. */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const DOCUMENT_TYPES = [
  ...IMAGE_TYPES,
  'image/gif',
  'image/heic',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
  'text/csv',
];

/**
 * Where staff uploads may go and what each accepts. Files are served from the public bucket with
 * the declared type, so anything a browser would run (HTML, SVG, scripts) is never accepted.
 */
const UPLOAD_FOLDERS: Record<string, readonly string[]> = {
  'organization/header-logo': IMAGE_TYPES,
  'program-workflow/contracts': DOCUMENT_TYPES,
  'program-workflow/welcome-guides': DOCUMENT_TYPES,
  'client-documents': DOCUMENT_TYPES,
};

/** Checks a requested upload and returns the storage folder to use (default: general documents). */
export function assertUploadAllowed(input: { folder?: unknown; type: unknown; size: unknown }): {
  folder: string;
  type: string;
  size: number;
} {
  const folder = typeof input.folder === 'string' && input.folder.trim() ? input.folder.trim().replace(/^\/+|\/+$/g, '') : 'client-documents';
  const allowed = UPLOAD_FOLDERS[folder];
  if (!allowed) throw new BadRequestException('This upload location is not allowed.');
  const type = typeof input.type === 'string' ? input.type.trim().toLowerCase() : '';
  if (!allowed.includes(type)) {
    throw new BadRequestException(
      folder === 'organization/header-logo'
        ? 'Upload a PNG, JPEG or WebP image.'
        : 'Upload a PDF, image, Word, Excel, CSV or text file.',
    );
  }
  const size = Number(input.size);
  if (!Number.isFinite(size) || size <= 0) throw new BadRequestException('The file is empty.');
  if (size > MAX_UPLOAD_BYTES) throw new BadRequestException('Files can be at most 25 MB.');
  return { folder, type, size };
}
