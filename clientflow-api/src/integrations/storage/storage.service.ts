import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Environment } from '../../config/env';

export interface UploadTextResult {
  bucket: string;
  objectKey: string;
  byteSize: number;
  url: string;
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
  ): Promise<PresignedStorageUrl> {
    const client = this.getClient();
    const bucket = this.getBucketName();
    if (!client || !bucket) throw new ServiceUnavailableException('R2 is not configured.');
    const url = await getSignedUrl(client, new GetObjectCommand({
      Bucket: bucket,
      Key: objectKey,
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

  /** Uploads a small text document (e.g. an executed contract snapshot) and returns its storage location. */
  async uploadText(objectKey: string, content: string, contentType = 'text/plain'): Promise<UploadTextResult> {
    const client = this.getClient();
    const bucket = this.getBucketName();
    if (!client || !bucket) throw new ServiceUnavailableException('R2 is not configured.');

    const body = Buffer.from(content, 'utf8');
    await client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: objectKey,
      Body: body,
      ContentType: contentType,
    }));

    const url = this.getPublicUrl(objectKey) ?? `https://${bucket}.r2.cloudflarestorage.com/${objectKey}`;
    return { bucket, objectKey, byteSize: body.byteLength, url };
  }
}
