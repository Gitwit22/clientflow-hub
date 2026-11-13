import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CopyObjectCommand, DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Environment } from '../../config/env';

export interface UploadTextResult {
  bucket: string;
  objectKey: string;
  byteSize: number;
  url: string;
}

/**
 * Where a stored file lives. `private` holds contracts and client documents and is only ever read
 * through short-lived presigned links. `public` holds files that must stay reachable from inside
 * sent emails (the header logo and email images). A stored row records the logical name, never a
 * raw bucket name, so a row can only ever point at one of the two configured buckets.
 */
export type StorageBucket = 'private' | 'public';

export const PUBLIC_STORAGE_NOT_CONFIGURED = "Public image storage isn't configured. Ask an administrator to set R2_PUBLIC_ASSETS_BUCKET and R2_PUBLIC_ASSETS_URL.";

/** Reads a stored row's bucket. Anything other than 'public' is the private bucket (older rows are null). */
export function storageBucketOf(row: { storageBucket?: string | null }): StorageBucket {
  return row.storageBucket === 'public' ? 'public' : 'private';
}

export interface PresignedStorageUrl {
  bucket: string;
  objectKey: string;
  url: string;
  expiresInSeconds: number;
}

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private client: S3Client | null | undefined;

  constructor(private readonly config: ConfigService<Environment, true>) {}

  assertEnabled(): void {
    if (this.config.get('STORAGE_ENABLED', { infer: true }) !== 'true') {
      throw new ServiceUnavailableException('ClientFlow storage is disabled.');
    }
  }

  isEnabled(): boolean {
    return this.config.get('STORAGE_ENABLED', { infer: true }) === 'true' && this.getClient() !== null;
  }

  private getClient(): S3Client | null {
    if (this.client !== undefined) return this.client;
    const accountId = this.config.get('R2_ACCOUNT_ID', { infer: true });
    const accessKeyId = this.config.get('R2_ACCESS_KEY_ID', { infer: true });
    const secretAccessKey = this.config.get('R2_SECRET_ACCESS_KEY', { infer: true });
    if (!accountId || !accessKeyId || !secretAccessKey) {
      this.client = null;
      return this.client;
    }
    this.client = new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId, secretAccessKey },
      forcePathStyle: true,
      requestChecksumCalculation: 'WHEN_REQUIRED',
    });
    return this.client;
  }

  private getBucketName(): string | undefined {
    return this.config.get('R2_BUCKET_NAME', { infer: true });
  }

  private getPublicUrl(objectKey: string): string | undefined {
    const publicUrl = this.config.get('R2_PUBLIC_URL', { infer: true });
    if (!publicUrl) return undefined;
    return `${publicUrl.replace(/\/+$/, '')}/${objectKey.replace(/^\/+/, '')}`;
  }

  getObjectPublicUrl(objectKey: string): string | undefined {
    return this.getPublicUrl(objectKey);
  }

  async createPresignedUploadUrl(
    objectKey: string,
    contentType: string,
    expiresInSeconds = 900,
  ): Promise<PresignedStorageUrl> {
    const client = this.getClient();
    const bucket = this.getBucketName();
    if (!client || !bucket) throw new ServiceUnavailableException('R2 is not configured.');
    const url = await getSignedUrl(client, new PutObjectCommand({
      Bucket: bucket,
      Key: objectKey,
      ContentType: contentType,
    }), { expiresIn: expiresInSeconds });
    return { bucket, objectKey, url, expiresInSeconds };
  }

  async createPresignedDownloadUrl(
    objectKey: string,
    expiresInSeconds = 300,
    /** `inline` opens the file in the browser (View) instead of saving it (Download). */
    options: { downloadFileName?: string; contentType?: string; inline?: boolean } = {},
  ): Promise<PresignedStorageUrl> {
    const client = this.getClient();
    const bucket = this.getBucketName();
    if (!client || !bucket) throw new ServiceUnavailableException('R2 is not configured.');
    const url = await getSignedUrl(client, new GetObjectCommand({
      Bucket: bucket,
      Key: objectKey,
      // Makes the link download as a named file instead of opening in the browser.
      ...(options.downloadFileName
        ? {
            ResponseContentDisposition: options.inline
              ? inlineDisposition(options.downloadFileName)
              : attachmentDisposition(options.downloadFileName),
          }
        : {}),
      ...(options.contentType ? { ResponseContentType: options.contentType } : {}),
    }), { expiresIn: expiresInSeconds });
    return { bucket, objectKey, url, expiresInSeconds };
  }

  async objectExists(objectKey: string): Promise<boolean> {
    const client = this.getClient();
    const bucket = this.getBucketName();
    if (!client || !bucket) throw new ServiceUnavailableException('R2 is not configured.');
    try {
      await client.send(new HeadObjectCommand({
        Bucket: bucket,
        Key: objectKey,
      }));
      return true;
    } catch {
      return false;
    }
  }

  /** The stored size of an object, or null when it isn't there. */
  async objectSize(objectKey: string): Promise<number | null> {
    const client = this.getClient();
    const bucket = this.getBucketName();
    if (!client || !bucket) throw new ServiceUnavailableException('R2 is not configured.');
    try {
      const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: objectKey }));
      return head.ContentLength ?? 0;
    } catch {
      return null;
    }
  }

  /** Permanently removes one object. Deleting a key that no longer exists succeeds. */
  async deleteObject(objectKey: string): Promise<void> {
    const client = this.getClient();
    const bucket = this.getBucketName();
    if (!client || !bucket) throw new ServiceUnavailableException('R2 is not configured.');
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: objectKey }));
  }

  /** True when the public assets bucket and its public URL are both configured. */
  isPublicAssetsConfigured(): boolean {
    return Boolean(this.config.get('R2_PUBLIC_ASSETS_BUCKET', { infer: true }) && this.publicAssetsBase());
  }

  private publicAssetsBase(): URL | null {
    const raw = this.config.get('R2_PUBLIC_ASSETS_URL', { infer: true });
    if (!raw) return null;
    try {
      const url = new URL(raw);
      return url.protocol === 'https:' || url.protocol === 'http:' ? url : null;
    } catch {
      return null;
    }
  }

  /** The configured bucket behind a logical name. Public storage that isn't configured is a clear 503. */
  private bucketFor(bucket: StorageBucket): { client: S3Client; name: string } {
    const client = this.getClient();
    if (bucket === 'public') {
      const name = this.config.get('R2_PUBLIC_ASSETS_BUCKET', { infer: true });
      if (!client || !name || !this.publicAssetsBase()) throw new ServiceUnavailableException(PUBLIC_STORAGE_NOT_CONFIGURED);
      return { client, name };
    }
    const name = this.getBucketName();
    if (!client || !name) throw new ServiceUnavailableException('R2 is not configured.');
    return { client, name };
  }

  /** The origin public images are served from, e.g. `https://images.example.org`, or null when unset. */
  publicAssetsOrigin(): string | null {
    return this.publicAssetsBase()?.origin ?? null;
  }

  /**
   * The permanent URL of an object in the public assets bucket. Each key segment is encoded, so a
   * stored key can never change the host or escape the configured base path.
   */
  publicAssetUrl(objectKey: string): string {
    const base = this.publicAssetsBase();
    if (!base || !this.config.get('R2_PUBLIC_ASSETS_BUCKET', { infer: true })) {
      throw new ServiceUnavailableException(PUBLIC_STORAGE_NOT_CONFIGURED);
    }
    const segments = objectKey.replace(/^\/+/, '').split('/');
    // Keys are generated by the API, but a dot or empty segment could still resolve outside the base path.
    if (!segments.length || segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
      throw new Error('Invalid storage key for a public asset URL.');
    }
    const basePath = base.pathname.replace(/\/+$/, '');
    return new URL(`${basePath}/${segments.map(encodeURIComponent).join('/')}`, base.origin).toString();
  }

  /** A presigned PUT into the given bucket. */
  async createPresignedUploadUrlIn(
    bucket: StorageBucket,
    objectKey: string,
    contentType: string,
    expiresInSeconds = 900,
  ): Promise<PresignedStorageUrl> {
    if (bucket === 'private') return this.createPresignedUploadUrl(objectKey, contentType, expiresInSeconds);
    const target = this.bucketFor(bucket);
    const url = await getSignedUrl(target.client, new PutObjectCommand({
      Bucket: target.name,
      Key: objectKey,
      ContentType: contentType,
    }), { expiresIn: expiresInSeconds });
    return { bucket: target.name, objectKey, url, expiresInSeconds };
  }

  /** The stored size of an object in the given bucket, or null when it isn't there. */
  async objectSizeIn(bucket: StorageBucket, objectKey: string): Promise<number | null> {
    if (bucket === 'private') return this.objectSize(objectKey);
    const target = this.bucketFor(bucket);
    try {
      const head = await target.client.send(new HeadObjectCommand({ Bucket: target.name, Key: objectKey }));
      return head.ContentLength ?? 0;
    } catch {
      return null;
    }
  }

  /** The first `byteCount` bytes of an object, used to check a file really is the type it claims. */
  async readObjectStart(bucket: StorageBucket, objectKey: string, byteCount: number): Promise<Buffer | null> {
    const target = this.bucketFor(bucket);
    try {
      const response = await target.client.send(new GetObjectCommand({
        Bucket: target.name,
        Key: objectKey,
        Range: `bytes=0-${Math.max(0, byteCount - 1)}`,
      }));
      const bytes = await response.Body?.transformToByteArray();
      return bytes ? Buffer.from(bytes) : null;
    } catch {
      return null;
    }
  }

  /** Permanently removes one object from the given bucket. */
  async deleteObjectIn(bucket: StorageBucket, objectKey: string): Promise<void> {
    if (bucket === 'private') return this.deleteObject(objectKey);
    const target = this.bucketFor(bucket);
    await target.client.send(new DeleteObjectCommand({ Bucket: target.name, Key: objectKey }));
  }

  /**
   * Copies one object from the private bucket into the public assets bucket under the same key.
   * Used once to move the email header logo out of the private bucket.
   */
  async copyPrivateObjectToPublic(objectKey: string): Promise<void> {
    const source = this.bucketFor('private');
    const target = this.bucketFor('public');
    if (source.name === target.name) {
      throw new ServiceUnavailableException('The public assets bucket must be different from the private bucket.');
    }
    await target.client.send(new CopyObjectCommand({
      Bucket: target.name,
      Key: objectKey,
      CopySource: `${source.name}/${objectKey.split('/').map(encodeURIComponent).join('/')}`,
    }));
  }

  /** Uploads a small text document (e.g. an executed contract snapshot) and returns its storage location. */
  async uploadText(objectKey: string, content: string, contentType = 'text/plain'): Promise<UploadTextResult> {
    return this.uploadBuffer(objectKey, Buffer.from(content, 'utf8'), contentType);
  }

  /** Uploads a small generated file (e.g. an executed contract PDF) and returns its storage location. */
  async uploadBuffer(
    objectKey: string,
    body: Buffer,
    contentType: string,
    downloadFileName?: string,
  ): Promise<UploadTextResult> {
    const client = this.getClient();
    const bucket = this.getBucketName();
    if (!client || !bucket) throw new ServiceUnavailableException('R2 is not configured.');

    await client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: objectKey,
      Body: body,
      ContentType: contentType,
      ...(downloadFileName ? { ContentDisposition: attachmentDisposition(downloadFileName) } : {}),
    }));

    const url = this.getPublicUrl(objectKey) ?? `https://${bucket}.r2.cloudflarestorage.com/${objectKey}`;
    return { bucket, objectKey, byteSize: body.byteLength, url };
  }
}

/** `attachment` disposition with an ASCII fallback name plus the RFC 5987 UTF-8 name. */
export function attachmentDisposition(fileName: string): string {
  return contentDisposition('attachment', fileName);
}

/** Same file name, but the browser shows the file in the tab instead of saving it. */
export function inlineDisposition(fileName: string): string {
  return contentDisposition('inline', fileName);
}

function contentDisposition(kind: 'attachment' | 'inline', fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, '').replace(/["\\]/g, '').trim() || 'download';
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}
