import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { Environment } from '../../config/env';

export interface UploadTextResult {
  bucket: string;
  objectKey: string;
  byteSize: number;
  url: string;
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

