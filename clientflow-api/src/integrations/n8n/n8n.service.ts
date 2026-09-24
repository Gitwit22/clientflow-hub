import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Environment } from '../../config/env';
import type {
  ClientflowLifecyclePayload,
  ContractEmailDeliveryResult,
  ContractEmailPayload,
  ContractSendLifecyclePayload,
  FormSendLifecyclePayload,
  IntakeEmailDeliveryResult,
  IntakeEmailPayload,
  N8nDeliveryReceipt,
  WelcomeEmailDeliveryResult,
  WelcomeEmailPayload,
  WelcomeSendLifecyclePayload,
} from './n8n.types';

@Injectable()
export class N8nService {
  constructor(private readonly config: ConfigService<Environment, true>) {}

  // Both the legacy clientflow-api names and the aliases shared with nxt-lvl-api2 must be honored -
  // deliver() already resolved aliases while the send* methods below did not, so the same n8n
  // configuration could behave as "enabled" for one code path (Forms page) and "disabled" for
  // another (Add client) depending on which env var names were actually set.
  private resolveN8nConfig() {
    const enabled = this.config.get('N8N_ENABLED', { infer: true }) === 'true'
      || this.config.get('N8N_FORM_EMAIL_ENABLED', { infer: true }) === 'true'
      || this.config.get('CLIENTFLOW_N8N_FORM_EMAIL_ENABLED', { infer: true }) === 'true';
    const webhookUrl = this.config.get('N8N_EMAIL_WEBHOOK_URL', { infer: true })
      ?? this.config.get('CLIENTFLOW_N8N_FORM_EMAIL_WEBHOOK_URL', { infer: true })
      ?? this.config.get('N8N_FORM_EMAIL_WEBHOOK_URL', { infer: true });
    const secret = this.config.get('CLIENTFLOW_N8N_SECRET', { infer: true })
      ?? this.config.get('CLIENTFLOW_N8N_CLIENTFLOW_SECRET', { infer: true })
      ?? this.config.get('N8N_CLIENTFLOW_SECRET', { infer: true });
    const rawBearerToken = this.config.get('N8N_EMAIL_BEARER_TOKEN', { infer: true })
      ?? this.config.get('CLIENTFLOW_N8N_FORM_EMAIL_BEARER_TOKEN', { infer: true })
      ?? this.config.get('N8N_FORM_EMAIL_BEARER_TOKEN', { infer: true });
    const bearerToken = rawBearerToken?.replace(/^Bearer\s+/i, '');
    const timeoutMs = this.config.get('N8N_FORM_EMAIL_TIMEOUT_MS', { infer: true })
      ?? this.config.get('N8N_TIMEOUT_MS', { infer: true });
    return { enabled, webhookUrl, secret, bearerToken, timeoutMs };
  }

  getIntakeAvailability(): 'ready' | 'disabled' | 'not_configured' {
    const { enabled, webhookUrl, secret } = this.resolveN8nConfig();
    if (!enabled) return 'disabled';
    return webhookUrl && secret ? 'ready' : 'not_configured';
  }

  /** Safe (no secrets) snapshot of which n8n env vars are resolving, for diagnosing config drift. */
  getDiagnostics() {
    const { enabled, webhookUrl, secret, bearerToken, timeoutMs } = this.resolveN8nConfig();
    return {
      availability: this.getIntakeAvailability(),
      enabledFrom: this.config.get('N8N_ENABLED', { infer: true }) === 'true'
        ? 'N8N_ENABLED'
        : this.config.get('N8N_FORM_EMAIL_ENABLED', { infer: true }) === 'true'
          ? 'N8N_FORM_EMAIL_ENABLED'
          : this.config.get('CLIENTFLOW_N8N_FORM_EMAIL_ENABLED', { infer: true }) === 'true'
            ? 'CLIENTFLOW_N8N_FORM_EMAIL_ENABLED'
            : null,
      hasWebhookUrl: Boolean(webhookUrl),
      hasSecret: Boolean(secret),
      hasBearerToken: Boolean(bearerToken),
      timeoutMs,
      enabled,
    };
  }

  getContractAvailability(): 'ready' | 'disabled' | 'not_configured' {
    return this.getIntakeAvailability();
  }

  getWelcomeAvailability(): 'ready' | 'disabled' | 'not_configured' {
    return this.getIntakeAvailability();
  }

  // sendIntake/sendContract/sendWelcome all delegate to deliver() for a single HTTP transport, but
  // each must supply its OWN real eventType - n8n's workflow switches on eventType and validates
  // different required fields per branch (form.send needs formName/formUrl, contract.send needs
  // contractName/contractUrl, welcome.send needs clientName/programName/nextStep). Forcing every
  // send through 'form.send' made contract/welcome payloads fail that branch's validation.
  private async sendViaDeliver<T extends ClientflowLifecyclePayload>(
    availability: 'ready' | 'disabled' | 'not_configured',
    eventId: string,
    payload: Omit<T, 'eventId' | 'occurredAt'>,
  ): Promise<
    | { status: 'sent'; sentAt: string }
    | { status: 'skipped'; reason: 'disabled' | 'not_configured' }
    | { status: 'failed'; reason: 'timeout' | 'rejected' | 'unavailable' }
  > {
    if (availability !== 'ready') return { status: 'skipped', reason: availability };
    try {
      const receipt = await this.deliver({
        ...payload,
        eventId,
        occurredAt: new Date().toISOString(),
      } as T);
      return { status: 'sent', sentAt: receipt.sentAt };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return { status: 'failed', reason: 'timeout' };
      if (error instanceof ServiceUnavailableException && /rejected|invalid receipt/.test(error.message)) {
        return { status: 'failed', reason: 'rejected' };
      }
      return { status: 'failed', reason: 'unavailable' };
    }
  }

  async sendIntake(eventId: string, payload: IntakeEmailPayload): Promise<IntakeEmailDeliveryResult> {
    return this.sendViaDeliver<FormSendLifecyclePayload>(this.getIntakeAvailability(), eventId, {
      ...payload,
      eventType: 'form.send',
      formPurpose: 'general_intake',
    });
  }

  async sendContract(
    eventId: string,
    payload: ContractEmailPayload,
  ): Promise<ContractEmailDeliveryResult> {
    return this.sendViaDeliver<ContractSendLifecyclePayload>(this.getContractAvailability(), eventId, {
      ...payload,
      eventType: 'contract.send',
    });
  }

  async sendWelcome(
    eventId: string,
    payload: WelcomeEmailPayload,
  ): Promise<WelcomeEmailDeliveryResult> {
    return this.sendViaDeliver<WelcomeSendLifecyclePayload>(this.getWelcomeAvailability(), eventId, {
      ...payload,
      eventType: 'welcome.send',
    });
  }

  async deliver(payload: ClientflowLifecyclePayload): Promise<N8nDeliveryReceipt> {
    const { enabled, webhookUrl, secret, bearerToken, timeoutMs } = this.resolveN8nConfig();
    if (!enabled) {
      throw new ServiceUnavailableException('n8n delivery is disabled.');
    }
    if (!webhookUrl || !secret) throw new ServiceUnavailableException('n8n is not configured.');
    const outboundPayload = {
      ...payload,
      organizationId: this.config.get('N8N_ORGANIZATION_ID', { infer: true }) ?? payload.organizationId,
    };

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
        body: JSON.stringify(outboundPayload),
        signal: controller.signal,
      });
      if (!response.ok) {
        const body = await response.text().catch(() => '');
        // Logged without secrets so a rejected delivery can be diagnosed from server logs.
        console.error(`[n8n.deliver] rejected eventId=${payload.eventId} status=${response.status} body=${body.slice(0, 500)}`);
        throw new ServiceUnavailableException('n8n rejected the event.');
      }
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
