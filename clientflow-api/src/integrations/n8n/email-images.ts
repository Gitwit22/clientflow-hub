import type { StorageService } from '../storage/storage.service';

/**
 * Images in staff-written emails: a line on its own of the form `![alt text](https://…)`.
 * Only images uploaded to this organization's email-images folder in the public assets bucket can
 * be shown; any other image line stays plain text. Rules shared by the formatter (rendering) and
 * the program email service (which also checks the file was really uploaded).
 */
export const EMAIL_IMAGE_LINE = /^!\[([^\]\n]*)\]\((https:\/\/[^\s)]+)\)$/;

export interface EmailImageRef {
  alt: string;
  url: string;
}

/** Every image line in a message, in order. */
export function emailImagesIn(body: string): EmailImageRef[] {
  return body
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => EMAIL_IMAGE_LINE.exec(line.trim()))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => ({ alt: match[1].trim(), url: match[2] }));
}

/** Decides whether an image URL may be shown in an email. */
export type EmailImagePolicy = (url: string) => boolean;

/**
 * The storage key an image URL points at, when it is an image of this organization's email-images
 * folder in the configured public bucket; null for anything else (another host, another
 * organization's folder, a crafted path).
 */
export function emailImageKeyFor(storage: Pick<StorageService, 'isPublicAssetsConfigured' | 'publicAssetUrl'>, organizationId: string, url: string): string | null {
  if (!storage.isPublicAssetsConfigured()) return null;
  let parsed: URL;
  let folderUrl: URL;
  try {
    parsed = new URL(url);
    // The public URL of the organization's folder, built the same way uploads are addressed.
    folderUrl = new URL(storage.publicAssetUrl(`email-images/${organizationId}/x`).replace(/x$/, ''));
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' || parsed.origin !== folderUrl.origin) return null;
  if (parsed.search || parsed.hash || parsed.username || parsed.password) return null;
  if (!parsed.pathname.startsWith(folderUrl.pathname)) return null;
  const fileName = decodeURIComponent(parsed.pathname.slice(folderUrl.pathname.length));
  if (!fileName || fileName.includes('/') || fileName === '.' || fileName === '..') return null;
  return `email-images/${organizationId}/${fileName}`;
}

/** The rendering policy for one organization: only its own email images. */
export function emailImagePolicyFor(storage: Pick<StorageService, 'isPublicAssetsConfigured' | 'publicAssetUrl'>, organizationId: string): EmailImagePolicy {
  return (url) => emailImageKeyFor(storage, organizationId, url) !== null;
}
