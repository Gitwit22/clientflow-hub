import { ServiceUnavailableException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Environment } from '../../config/env';
import { assertStoredUploadAcceptable } from '../../modules/compatibility/compatibility.controller';
import { LogoStorageService } from '../../modules/maintenance/logo-storage.service';
import { publicLogoUrl } from '../n8n/email-branding';
import { StorageService, storageBucketOf } from './storage.service';

function storageWith(env: Partial<Environment>): StorageService {
  const config = { get: (key: keyof Environment) => env[key] } as unknown as ConfigService<Environment, true>;
  return new StorageService(config);
}

const configured: Partial<Environment> = {
  STORAGE_ENABLED: 'true',
  R2_ACCOUNT_ID: 'acct',
  R2_ACCESS_KEY_ID: 'key',
  R2_SECRET_ACCESS_KEY: 'secret',
  R2_BUCKET_NAME: 'private-bucket',
  R2_PUBLIC_ASSETS_BUCKET: 'public-bucket',
  R2_PUBLIC_ASSETS_URL: 'https://images.example.org/assets/',
};

describe('public assets storage', () => {
  it('builds permanent public URLs that stay on the configured host and path', () => {
    const storage = storageWith(configured);
    expect(storage.publicAssetUrl('email-images/org-1/1-abc-my photo.png'))
      .toBe('https://images.example.org/assets/email-images/org-1/1-abc-my%20photo.png');
    // A key can never move the URL to another host or out of the base path.
    expect(new URL(storage.publicAssetUrl('//evil.example.com/x.png')).host).toBe('images.example.org');
    expect(storage.publicAssetUrl('//evil.example.com/x.png')).toBe('https://images.example.org/assets/evil.example.com/x.png');
    for (const key of ['../../x.png', 'email-images/./x.png', 'email-images//x.png', '']) {
      expect(() => storage.publicAssetUrl(key)).toThrow('Invalid storage key');
    }
    expect(storage.publicAssetsOrigin()).toBe('https://images.example.org');
  });

  it('fails clearly when the public bucket is not configured', async () => {
    const storage = storageWith({ ...configured, R2_PUBLIC_ASSETS_BUCKET: undefined });
    expect(storage.isPublicAssetsConfigured()).toBe(false);
    expect(() => storage.publicAssetUrl('email-images/org-1/x.png')).toThrow(ServiceUnavailableException);
    await expect(storage.createPresignedUploadUrlIn('public', 'email-images/org-1/x.png', 'image/png'))
      .rejects.toThrow("Public image storage isn't configured");
  });

  it('reads a row bucket as private unless it is exactly public', () => {
    expect(storageBucketOf({ storageBucket: null })).toBe('private');
    expect(storageBucketOf({})).toBe('private');
    expect(storageBucketOf({ storageBucket: 'some-other-bucket' })).toBe('private');
    expect(storageBucketOf({ storageBucket: 'public' })).toBe('public');
  });
});

describe('finishing an upload', () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  function fakeStorage(size: number | null, firstBytes: Buffer | null) {
    return {
      objectSize: jest.fn().mockResolvedValue(size),
      objectSizeIn: jest.fn().mockResolvedValue(size),
      readObjectStart: jest.fn().mockResolvedValue(firstBytes),
      deleteObject: jest.fn().mockResolvedValue(undefined),
      deleteObjectIn: jest.fn().mockResolvedValue(undefined),
    };
  }

  it('accepts a real image in the public bucket', async () => {
    const storage = fakeStorage(100, png);
    await expect(assertStoredUploadAcceptable(storage as never, {
      storageKey: 'email-images/org-1/1-a-photo.png', mimeType: 'image/png', storageBucket: 'public',
    })).resolves.toBeUndefined();
    expect(storage.readObjectStart).toHaveBeenCalledWith('public', 'email-images/org-1/1-a-photo.png', 16);
    expect(storage.deleteObjectIn).not.toHaveBeenCalled();
  });

  it('removes and rejects a public file whose bytes are not the declared image type', async () => {
    const storage = fakeStorage(100, Buffer.from('<html><script>alert(1)</script>'));
    await expect(assertStoredUploadAcceptable(storage as never, {
      storageKey: 'email-images/org-1/1-a-photo.png', mimeType: 'image/png', storageBucket: 'public',
    })).rejects.toThrow("isn't a valid image");
    expect(storage.deleteObjectIn).toHaveBeenCalledWith('public', 'email-images/org-1/1-a-photo.png');
  });

  it('removes and rejects an email image over 5 MB', async () => {
    const storage = fakeStorage(5 * 1024 * 1024 + 1, png);
    await expect(assertStoredUploadAcceptable(storage as never, {
      storageKey: 'email-images/org-1/1-a-photo.png', mimeType: 'image/png', storageBucket: 'public',
    })).rejects.toThrow('at most 5 MB');
    expect(storage.deleteObjectIn).toHaveBeenCalled();
  });

  it('checks private files by size only, as before', async () => {
    const storage = fakeStorage(100, null);
    await expect(assertStoredUploadAcceptable(storage as never, {
      storageKey: 'program-workflow/contracts/org-1/1-a.pdf', mimeType: 'application/pdf', storageBucket: null,
    })).resolves.toBeUndefined();
    expect(storage.objectSize).toHaveBeenCalledWith('program-workflow/contracts/org-1/1-a.pdf');
    expect(storage.readObjectStart).not.toHaveBeenCalled();
  });
});

describe('email header logo location', () => {
  function prismaWith(file: { storageKey: string; storageBucket: string | null } | null) {
    return { cfStoredFile: { findFirst: jest.fn().mockResolvedValue(file) } };
  }

  it('uses the public assets bucket once the logo has moved', async () => {
    const storage = storageWith(configured);
    const url = await publicLogoUrl(prismaWith({ storageKey: 'organization/header-logo/org-1/logo.png', storageBucket: 'public' }) as never, storage, 'org-1', 'file-1');
    expect(url).toBe('https://images.example.org/assets/organization/header-logo/org-1/logo.png');
  });

  it('falls back to the legacy public URL for a logo still in the private bucket', async () => {
    const storage = storageWith({ ...configured, R2_PUBLIC_URL: 'https://pub-old.r2.dev' });
    const url = await publicLogoUrl(prismaWith({ storageKey: 'organization/header-logo/org-1/logo.png', storageBucket: null }) as never, storage, 'org-1', 'file-1');
    expect(url).toBe('https://pub-old.r2.dev/organization/header-logo/org-1/logo.png');
  });

  it('sends without a logo rather than failing when the public bucket is not configured', async () => {
    const storage = storageWith({ ...configured, R2_PUBLIC_ASSETS_URL: undefined });
    const url = await publicLogoUrl(prismaWith({ storageKey: 'organization/header-logo/org-1/logo.png', storageBucket: 'public' }) as never, storage, 'org-1', 'file-1');
    expect(url).toBeUndefined();
  });
});

describe('moving the logo to the public bucket', () => {
  const actor = { id: 'admin-1', role: 'org_admin' } as never;

  function setup(logo: { id: string; storageKey: string; storageBucket: string | null } | null, sizes: [number | null, number | null] = [10, 10]) {
    const prisma = {
      organization: { findUnique: jest.fn().mockResolvedValue({ settings: logo ? { logoStoredFileId: logo.id } : {} }) },
      cfStoredFile: {
        findFirst: jest.fn().mockResolvedValue(logo),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const storage = {
      isPublicAssetsConfigured: jest.fn().mockReturnValue(true),
      copyPrivateObjectToPublic: jest.fn().mockResolvedValue(undefined),
      objectSizeIn: jest.fn().mockImplementation((bucket: string) => Promise.resolve(bucket === 'private' ? sizes[0] : sizes[1])),
    };
    return { prisma, storage, service: new LogoStorageService(prisma as never, storage as never) };
  }

  it('copies the logo, verifies the copy, then switches the record once', async () => {
    const { prisma, storage, service } = setup({ id: 'file-1', storageKey: 'organization/header-logo/org-1/logo.png', storageBucket: null });
    await expect(service.moveToPublic('org-1', actor)).resolves.toEqual({ status: 'public_bucket', publicAssetsConfigured: true, moved: true });
    expect(storage.copyPrivateObjectToPublic).toHaveBeenCalledWith('organization/header-logo/org-1/logo.png');
    expect(prisma.cfStoredFile.updateMany).toHaveBeenCalledWith({
      where: { id: 'file-1', organizationId: 'org-1', storageBucket: null },
      data: { storageBucket: 'public' },
    });
  });

  it('changes nothing when the copy is incomplete', async () => {
    const { prisma, service } = setup({ id: 'file-1', storageKey: 'k', storageBucket: null }, [10, null]);
    await expect(service.moveToPublic('org-1', actor)).rejects.toThrow("couldn't be copied");
    expect(prisma.cfStoredFile.updateMany).not.toHaveBeenCalled();
  });

  it('is a no-op for a logo that already moved, or when there is no logo', async () => {
    const moved = setup({ id: 'file-1', storageKey: 'k', storageBucket: 'public' });
    await expect(moved.service.moveToPublic('org-1', actor)).resolves.toMatchObject({ status: 'public_bucket', moved: false });
    expect(moved.storage.copyPrivateObjectToPublic).not.toHaveBeenCalled();
    const none = setup(null);
    await expect(none.service.moveToPublic('org-1', actor)).resolves.toMatchObject({ status: 'no_logo', moved: false });
  });

  it('requires the public bucket to be configured', async () => {
    const { storage, service } = setup({ id: 'file-1', storageKey: 'k', storageBucket: null });
    storage.isPublicAssetsConfigured.mockReturnValue(false);
    await expect(service.moveToPublic('org-1', actor)).rejects.toThrow("isn't configured");
  });
});
