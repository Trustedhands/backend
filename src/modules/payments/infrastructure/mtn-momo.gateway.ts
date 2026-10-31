import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../../config/env.js';
import { UnavailableError } from '../../../shared/domain/domain-error.js';
import {
  MobileMoneyGateway,
  PaymentRejectedError,
  type ProviderPaymentStatus,
} from '../application/mobile-money.gateway.js';

const TIMEOUT_MS = 20_000;
/** Refresh the access token this long before it expires */
const TOKEN_SKEW_MS = 60_000;

/**
 * MTN MoMo Collections API: https://momodeveloper.mtn.com/api-documentation
 * Sandbox only accepts EUR; production in Rwanda uses RWF.
 */
@Injectable()
export class MtnMomoGateway extends MobileMoneyGateway {
  private readonly logger = new Logger(MtnMomoGateway.name);
  private token: { value: string; expiresAt: number } | null = null;

  constructor(private readonly config: ConfigService<Env, true>) {
    super();
  }

  async requestToPay(input: {
    referenceId: string;
    amount: number;
    msisdn: string;
    externalId: string;
    message: string;
  }): Promise<void> {
    const callbackBase = this.config.get('MOMO_CALLBACK_URL', { infer: true });
    const res = await this.call('/collection/v1_0/requesttopay', {
      method: 'POST',
      headers: {
        'X-Reference-Id': input.referenceId,
        'Content-Type': 'application/json',
        ...(callbackBase
          ? {
              'X-Callback-Url': `${callbackBase.replace(/\/$/, '')}/${input.externalId}`,
            }
          : {}),
      },
      body: JSON.stringify({
        amount: String(input.amount),
        currency: this.config.get('MOMO_CURRENCY', { infer: true }),
        externalId: input.externalId,
        payer: { partyIdType: 'MSISDN', partyId: input.msisdn },
        payerMessage: input.message,
        payeeNote: input.message,
      }),
    });

    if (res.status === 202) return;
    const detail = await res.text();
    if (res.status >= 400 && res.status < 500) {
      this.logger.warn(`requesttopay rejected (${res.status}): ${detail}`);
      throw new PaymentRejectedError(
        `MoMo rejected the payment request (${res.status})`,
      );
    }
    throw new UnavailableError(
      'momo_unavailable',
      `MoMo returned ${res.status}`,
    );
  }

  async getStatus(referenceId: string): Promise<ProviderPaymentStatus> {
    const res = await this.call(
      `/collection/v1_0/requesttopay/${referenceId}`,
      { method: 'GET' },
    );
    if (res.status === 404) return { status: 'NOT_FOUND' };
    if (!res.ok) {
      throw new UnavailableError(
        'momo_unavailable',
        `MoMo status check returned ${res.status}`,
      );
    }
    const body = (await res.json()) as {
      status: string;
      financialTransactionId?: string;
      reason?: string | { code?: string; message?: string };
    };
    switch (body.status) {
      case 'SUCCESSFUL':
        return {
          status: 'SUCCESSFUL',
          transactionId: body.financialTransactionId ?? null,
        };
      case 'FAILED':
      case 'REJECTED':
      case 'TIMEOUT': {
        const reason =
          typeof body.reason === 'string'
            ? body.reason
            : (body.reason?.message ?? body.reason?.code ?? body.status);
        return { status: 'FAILED', reason };
      }
      default:
        return { status: 'PENDING' };
    }
  }

  private async call(path: string, init: RequestInit): Promise<Response> {
    const token = await this.accessToken();
    return fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        ...init.headers,
        Authorization: `Bearer ${token}`,
        'X-Target-Environment': this.config.get('MOMO_TARGET_ENVIRONMENT', {
          infer: true,
        }),
        'Ocp-Apim-Subscription-Key': this.credentials().subscriptionKey,
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt - TOKEN_SKEW_MS > Date.now()) {
      return this.token.value;
    }
    const { subscriptionKey, apiUser, apiKey } = this.credentials();
    const res = await fetch(`${this.baseUrl}/collection/token/`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${apiUser}:${apiKey}`).toString('base64')}`,
        'Ocp-Apim-Subscription-Key': subscriptionKey,
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      this.logger.error(
        `MoMo token request failed (${res.status}): ${await res.text()}`,
      );
      throw new UnavailableError(
        'momo_auth_failed',
        'Could not authenticate with MoMo',
      );
    }
    const body = (await res.json()) as {
      access_token: string;
      expires_in: number;
    };
    this.token = {
      value: body.access_token,
      expiresAt: Date.now() + body.expires_in * 1000,
    };
    return this.token.value;
  }

  private get baseUrl(): string {
    return this.config.get('MOMO_BASE_URL', { infer: true }).replace(/\/$/, '');
  }

  private credentials() {
    const subscriptionKey = this.config.get('MOMO_SUBSCRIPTION_KEY', {
      infer: true,
    });
    const apiUser = this.config.get('MOMO_API_USER', { infer: true });
    const apiKey = this.config.get('MOMO_API_KEY', { infer: true });
    if (!subscriptionKey || !apiUser || !apiKey) {
      throw new UnavailableError(
        'momo_not_configured',
        'Mobile Money payments are not configured yet',
      );
    }
    return { subscriptionKey, apiUser, apiKey };
  }
}
