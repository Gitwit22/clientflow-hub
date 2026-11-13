import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { requireManager, type RoleActor } from '../../common/authorization/role-policy';
import { logoStoredFileIdFromSettings } from '../../integrations/n8n/email-branding';
import { StorageService } from '../../integrations/storage/storage.service';
import { PrismaService } from '../../prisma/prisma.service';

export type LogoStorageStatus =
  /** No header logo is set in Settings. */
  | 'no_logo'
  /** The logo is in the private bucket and is only reachable while R2_PUBLIC_URL is set. */
  | 'private_bucket'
  /** The logo is in the public assets bucket. */
  | 'public_bucket';

export interface LogoStorageReport {
  status: LogoStorageStatus;
  /** Whether the public assets bucket is configured, so the logo can be moved. */
  publicAssetsConfigured: boolean;
  /** True when this call moved the logo. */
  moved: boolean;
}

/**
 * Moves the email header logo out of the private bucket into the public assets bucket, so the
 * private bucket (contracts, client documents) can have its public access turned off without the
 * logo disappearing from new emails. Idempotent: a logo that already moved is left alone.
 */
@Injectable()
export class LogoStorageService {
  private readonly logger = new Logger(LogoStorageService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async status(organizationId: string, actor: RoleActor): Promise<LogoStorageReport> {
    requireManager(actor);
    const logo = await this.currentLogo(organizationId);
    return {
      status: !logo ? 'no_logo' : logo.storageBucket === 'public' ? 'public_bucket' : 'private_bucket',
      publicAssetsConfigured: this.storage.isPublicAssetsConfigured(),
      moved: false,
    };
  }

  async moveToPublic(organizationId: string, actor: RoleActor & { id: string }): Promise<LogoStorageReport> {
    requireManager(actor);
    const before = await this.status(organizationId, actor);
    if (before.status !== 'private_bucket') return before;
    if (!before.publicAssetsConfigured) {
      throw new ServiceUnavailableException("The public assets bucket isn't configured, so the logo can't be moved yet.");
    }
    const logo = (await this.currentLogo(organizationId))!;

    await this.storage.copyPrivateObjectToPublic(logo.storageKey);
    // Only switch the record once the copy is really there and complete.
    const [sourceSize, copiedSize] = await Promise.all([
      this.storage.objectSizeIn('private', logo.storageKey),
      this.storage.objectSizeIn('public', logo.storageKey),
    ]);
    if (copiedSize === null || sourceSize === null || copiedSize !== sourceSize) {
      throw new ServiceUnavailableException("The logo couldn't be copied to the public assets bucket. Nothing was changed.");
    }

    // Guarded on the old value, so a repeated or concurrent move changes the row at most once.
    const updated = await this.prisma.cfStoredFile.updateMany({
      where: { id: logo.id, organizationId, storageBucket: null },
      data: { storageBucket: 'public' },
    });
    if (updated.count === 1) {
      await this.prisma.auditLog.create({
        data: {
          organizationId,
          actorAdminId: actor.id,
          action: 'updated',
          targetType: 'organization_logo_storage',
          targetId: logo.id,
          metadata: { from: 'private', to: 'public' },
        },
      });
      this.logger.log(`Moved the header logo of organization ${organizationId} to the public assets bucket.`);
    }
    return { status: 'public_bucket', publicAssetsConfigured: true, moved: updated.count === 1 };
  }

  private async currentLogo(organizationId: string) {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { settings: true },
    });
    const storedFileId = logoStoredFileIdFromSettings(organization?.settings);
    if (!storedFileId) return null;
    return this.prisma.cfStoredFile.findFirst({
      where: { id: storedFileId, organizationId },
      select: { id: true, storageKey: true, storageBucket: true },
    });
  }
}
