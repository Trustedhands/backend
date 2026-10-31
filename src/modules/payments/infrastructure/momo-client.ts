import { Logger } from '@nestjs/common';
import { UnavailableError } from '../../../shared/domain/domain-error.js';
import { PaymentRejectedError } from '../application/mobile-money.gateway.js';

const TIMEOUT_MS = 20_000;
/** Refresh the access token this long before it expires */
const TOKEN_SKEW_MS = 60_000;

export interface MomoProductConfig {
  product: 'collection' | 'disbursement';
  baseUrl: string;
  targetEnvironment: string;
  subscriptionKey?: string;
  apiUser?: string;
  apiKey?: string;
  /** Shown when keys are missing */
  notConfiguredMessage: string;
}

export interface MomoRawStatus {
  status: 'PENDING' | 'SUCCESSFUL' | 'FAILED' | 'NOT_FOUND';
  financialTransactionId: string | null;
  /** MTN's failure code, e.g. NOT_ENOUGH_FUNDS */
  code: string | null;
}

/**
 * One MTN MoMo product (Collections or Disbursement): token caching, request
 * submission and status checks. API: https://momodeveloper.mtn.com/api-documentation
 */
export class MomoProductClient {
  private readonly logger: Logger;
  private token: { value: string; expiresAt: number } | null = null;

  constructor(private readonly config: MomoProductConfig) {
    this.logger = new Logger(`MoMo:${config.product}`);
  }

  /** POST a request MoMo processes asynchronously (expects 202). */
  async submit(
    path: string,
    referenceId: string,
    body: object,
    callbackUrl?: string,
  ): Promise<void> {
    const res = await this.call(path, {
      method: 'POST',
      headers: {
        'X-Reference-Id': referenceId,
        'Content-Type': 'application/json',
        ...(callbackUrl ? { 'X-Callback-Url': callbackUrl } : {}),
      },
      body: JSON.stringify(body),
    });
    if (res.status === 202) return;
    const detail = await res.text();
    if (res.status >= 400 && res.status < 500) {
      this.logger.warn(`${path} rejected (${res.status}): ${detail}`);
      throw new PaymentRejectedError(
        `MoMo rejected the request (${res.status})`,
      );
    }
    throw new UnavailableError(
      'momo_unavailable',
      `MoMo returned ${res.status}`,
    );
  }

  async status(path: string): Promise<MomoRawStatus> {
    const res = await this.call(path, { method: 'GET' });
    if (res.status === 404)
      return { status: 'NOT_FOUND', financialTransactionId: null, code: null };
    if (!res.ok)
      throw new UnavailableError(
        'momo_unavailable',
        `MoMo status check returned ${res.status}`,
      );
    const body = (await res.json()) as {
      status: string;
      financialTransactionId?: string;
      reason?: string | { code?: string; message?: string };
    };
    if (body.status === 'SUCCESSFUL') {
      return {
        status: 'SUCCESSFUL',
        financialTransactionId: body.financialTransactionId ?? null,
        code: null,
      };
    }
    if (
      body.status === 'FAILED' ||
      body.status === 'REJECTED' ||
      body.status === 'TIMEOUT'
    ) {
      const code =
        typeof body.reason === 'string'
          ? body.reason
          : (body.reason?.code ?? body.reason?.message ?? body.status);
      this.logger.warn(`${path} ${body.status}: ${code}`);
      return { status: 'FAILED', financialTransactionId: null, code };
    }
    return { status: 'PENDING', financialTransactionId: null, code: null };
  }

  private async call(path: string, init: RequestInit): Promise<Response> {
    const token = await this.accessToken();
    return fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        ...init.headers,
        Authorization: `Bearer ${token}`,
        'X-Target-Environment': this.config.targetEnvironment,
        'Ocp-Apim-Subscription-Key': this.credentials().subscriptionKey,
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt - TOKEN_SKEW_MS > Date.now())
      return this.token.value;
    const { subscriptionKey, apiUser, apiKey } = this.credentials();
    const res = await fetch(`${this.baseUrl}/${this.config.product}/token/`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${apiUser}:${apiKey}`).toString('base64')}`,
        'Ocp-Apim-Subscription-Key': subscriptionKey,
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      this.logger.error(
        `Token request failed (${res.status}): ${await res.text()}`,
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
    return this.config.baseUrl.replace(/\/$/, '');
  }

  private credentials() {
    const { subscriptionKey, apiUser, apiKey } = this.config;
    if (!subscriptionKey || !apiUser || !apiKey) {
      throw new UnavailableError(
        'momo_not_configured',
        this.config.notConfiguredMessage,
      );
    }
    return { subscriptionKey, apiUser, apiKey };
  }
}

/** Callback URL for one object: `${base}/${suffix}`, or undefined when no base is configured. */
export function callbackUrl(
  base: string | undefined,
  suffix: string,
): string | undefined {
  return base ? `${base.replace(/\/$/, '')}/${suffix}` : undefined;
}
