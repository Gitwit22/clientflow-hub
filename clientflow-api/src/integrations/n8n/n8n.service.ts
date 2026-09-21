import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Environment } from '../../config/env';
import type {
  ClientflowLifecyclePayload,
  IntakeEmailDeliveryResult,
  IntakeEmailPayload,
  N8nDeliveryReceipt,
} from './n8n.types';

@Injectable()
export class N8nService {
  constructor(private readonly config: ConfigService<Environment, true>) {}

  getIntakeAvailability(): 'ready' | 'disabled' | 'not_configured' {
    if (this.config.get('N8N_ENABLED', { infer: true }) !== 'true') return 'disabled';
    return this.config.get('N8N_EMAIL_WEBHOOK_URL', { infer: true })
      && this.config.get('CLIENTFLOW_N8N_SECRET', { infer: true })
      ? 'ready'
      : 'not_configured';
  }

  async sendIntake(eventId: string, payload: IntakeEmailPayload): Promise<IntakeEmailDeliveryResult> {
    const availability = this.getIntakeAvailability();
    if (availability !== 'ready') return { status: 'skipped', reason: availability };

    const webhookUrl = this.config.get('N8N_EMAIL_WEBHOOK_URL', { infer: true })!;
    const secret = this.config.get('CLIENTFLOW_N8N_SECRET', { infer: true })!;
    const bearerToken = this.config.get('N8N_EMAIL_BEARER_TOKEN', { infer: true });
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.config.get('N8N_TIMEOUT_MS', { infer: true }),
    );

    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-clientflow-secret': secret,
          'Idempotency-Key': eventId,
          ...(bearerToken ? { Authorization: `Bearer ${bearerToken.replace(/^Bearer\s+/i, '')}` } : {}),
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      if (!response.ok) return { status: 'failed', reason: 'rejected' };
      return { status: 'sent', sentAt: new Date().toISOString() };
    } catch (error) {
      return {
        status: 'failed',
        reason: error instanceof Error && error.name === 'AbortError' ? 'timeout' : 'unavailable',
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  async deliver(payload: ClientflowLifecyclePayload): Promise<N8nDeliveryReceipt> {
    if (this.config.get('N8N_ENABLED', { infer: true }) !== 'true') {
      throw new ServiceUnavailableException('n8n delivery is disabled.');
    }
    const webhookUrl = this.config.get('N8N_EMAIL_WEBHOOK_URL', { infer: true });
    const secret = this.config.get('CLIENTFLOW_N8N_SECRET', { infer: true });
    const bearerToken = this.config.get('N8N_EMAIL_BEARER_TOKEN', { infer: true });
    const timeoutMs = this.config.get('N8N_TIMEOUT_MS', { infer: true });
    if (!webhookUrl || !secret) throw new ServiceUnavailableException('n8n is not configured.');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-clientflow-secret': secret,
          ...(bearerToken ? { Authorization: `Bearer ${bearerToken}` } : {}),
          'Idempotency-Key': payload.eventId,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      if (!response.ok) throw new ServiceUnavailableException('n8n rejected the event.');
      const receipt = await response.json() as Partial<N8nDeliveryReceipt>;
      if (receipt.success !== true || receipt.eventId !== payload.eventId || !receipt.sentAt) {
        throw new ServiceUnavailableException('n8n returned an invalid receipt.');
      }
      return receipt as N8nDeliveryReceipt;
    } finally {
      clearTimeout(timeout);
    }
  }
}
