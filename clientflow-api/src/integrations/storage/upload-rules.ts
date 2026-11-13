import { BadRequestException } from '@nestjs/common';
import type { StorageBucket } from './storage.service';

/** Largest file staff can upload. Contracts, guides and client documents are well under this. */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
/** Images inside emails: formats every common mail client shows (no WebP, which Outlook doesn't). */
const EMAIL_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif'];
/** Largest image staff can put in an email; bigger images make emails slow to open. */
export const MAX_EMAIL_IMAGE_BYTES = 5 * 1024 * 1024;
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
 * Where staff uploads may go, what each accepts, and which bucket holds it. Files are served with
 * the declared type, so anything a browser would run (HTML, SVG, scripts) is never accepted.
 * Only files that emails show inline go to the public bucket; everything else stays private.
 */
const UPLOAD_FOLDERS: Record<string, { types: readonly string[]; bucket: StorageBucket; maxBytes: number }> = {
  'organization/header-logo': { types: IMAGE_TYPES, bucket: 'public', maxBytes: MAX_UPLOAD_BYTES },
  'email-images': { types: EMAIL_IMAGE_TYPES, bucket: 'public', maxBytes: MAX_EMAIL_IMAGE_BYTES },
  'program-workflow/contracts': { types: DOCUMENT_TYPES, bucket: 'private', maxBytes: MAX_UPLOAD_BYTES },
  'program-workflow/welcome-guides': { types: DOCUMENT_TYPES, bucket: 'private', maxBytes: MAX_UPLOAD_BYTES },
  'client-documents': { types: DOCUMENT_TYPES, bucket: 'private', maxBytes: MAX_UPLOAD_BYTES },
};

const UPLOAD_TYPE_MESSAGES: Record<string, string> = {
  'organization/header-logo': 'Upload a PNG, JPEG or WebP image.',
  'email-images': 'Upload a PNG, JPEG or GIF image.',
};

/** Checks a requested upload and returns the storage folder to use (default: general documents). */
export function assertUploadAllowed(input: { folder?: unknown; type: unknown; size: unknown }): {
  folder: string;
  type: string;
  size: number;
  bucket: StorageBucket;
  maxBytes: number;
} {
  const folder = typeof input.folder === 'string' && input.folder.trim() ? input.folder.trim().replace(/^\/+|\/+$/g, '') : 'client-documents';
  const rule = UPLOAD_FOLDERS[folder];
  if (!rule) throw new BadRequestException('This upload location is not allowed.');
  const type = typeof input.type === 'string' ? input.type.trim().toLowerCase() : '';
  if (!rule.types.includes(type)) {
    throw new BadRequestException(UPLOAD_TYPE_MESSAGES[folder] ?? 'Upload a PDF, image, Word, Excel, CSV or text file.');
  }
  const size = Number(input.size);
  if (!Number.isFinite(size) || size <= 0) throw new BadRequestException('The file is empty.');
  if (size > rule.maxBytes) throw new BadRequestException(uploadLimitMessage(rule.maxBytes));
  return { folder, type, size, bucket: rule.bucket, maxBytes: rule.maxBytes };
}

/** The largest upload a folder accepts (25 MB unless the folder sets less). */
export function uploadLimitFor(folder: string): number {
  return UPLOAD_FOLDERS[folder]?.maxBytes ?? MAX_UPLOAD_BYTES;
}

export function uploadLimitMessage(maxBytes: number): string {
  return `Files can be at most ${Math.round(maxBytes / (1024 * 1024))} MB.`;
}

/** The storage folder a key was issued under (`email-images/org/123-…` → `email-images`). */
export function uploadFolderOfKey(storageKey: string): string | null {
  const folders = Object.keys(UPLOAD_FOLDERS).sort((a, b) => b.length - a.length);
  return folders.find((folder) => storageKey.startsWith(`${folder}/`)) ?? null;
}

const IMAGE_SIGNATURES: Record<string, (bytes: Buffer) => boolean> = {
  'image/png': (b) => b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/jpeg': (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/gif': (b) => b.length >= 6 && (b.subarray(0, 6).toString('latin1') === 'GIF87a' || b.subarray(0, 6).toString('latin1') === 'GIF89a'),
  'image/webp': (b) => b.length >= 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP',
};

/** Bytes to read from the start of a file to check its signature. */
export const SIGNATURE_BYTES = 16;

/**
 * Whether the first bytes of a file match its declared image type. A presigned upload fixes the
 * Content-Type header but not the bytes, so public images are checked before anyone can link them.
 */
export function matchesImageSignature(mimeType: string, firstBytes: Buffer): boolean {
  const check = IMAGE_SIGNATURES[mimeType.toLowerCase()];
  return check ? check(firstBytes) : false;
}
