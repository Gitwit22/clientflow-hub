import type { PrismaService } from '../../prisma/prisma.service';
import type { StorageService } from '../storage/storage.service';

/** The header logo configured in Settings, stored as `organization.settings.logoStoredFileId`. */
export function logoStoredFileIdFromSettings(settings: unknown): string | null {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return null;
  const value = (settings as Record<string, unknown>).logoStoredFileId;
  return typeof value === 'string' && value ? value : null;
}

/**
 * The email header logo is shown inline and must stay resolvable whenever the email is reopened
 * later, so this is the permanent public URL, never a short-lived presigned one.
 */
export async function publicLogoUrl(
  prisma: PrismaService,
  storage: StorageService,
  organizationId: string,
  storedFileId: string | null,
): Promise<string | undefined> {
  if (!storedFileId || !storage.isEnabled()) return undefined;
  const storedFile = await prisma.cfStoredFile.findFirst({
    where: { id: storedFileId, organizationId },
    select: { storageKey: true, storageBucket: true },
  });
  if (!storedFile) return undefined;
  if (storedFile.storageBucket === 'public') {
    // A logo in the public assets bucket. If that bucket isn't configured, send without a logo
    // rather than failing the email.
    return storage.isPublicAssetsConfigured() ? storage.publicAssetUrl(storedFile.storageKey) : undefined;
  }
  // Legacy: a logo still in the private bucket is only reachable while R2_PUBLIC_URL is set.
  // Move it to the public assets bucket (maintenance: move logo) so the private bucket can be closed.
  return storage.getObjectPublicUrl(storedFile.storageKey);
}

export async function organizationHeaderImageUrl(
  prisma: PrismaService,
  storage: StorageService,
  organizationId: string,
): Promise<string | undefined> {
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { settings: true },
  });
  return publicLogoUrl(prisma, storage, organizationId, logoStoredFileIdFromSettings(organization?.settings));
}
