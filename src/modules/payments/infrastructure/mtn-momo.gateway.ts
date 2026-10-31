import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../../config/env.js';
import {
  MobileMoneyGateway,
  type ProviderPaymentStatus,
} from '../application/mobile-money.gateway.js';
import { callbackUrl, MomoProductClient } from './momo-client.js';

/**
 * MTN MoMo Collections: charging clients. Sandbox only accepts EUR;
 * production in Rwanda uses RWF.
 */
@Injectable()
export class MtnMomoGateway extends MobileMoneyGateway {
  private readonly client: MomoProductClient;

  constructor(private readonly config: ConfigService<Env, true>) {
    super();
    this.client = new MomoProductClient({
      product: 'collection',
      baseUrl: config.get('MOMO_BASE_URL', { infer: true }),
      targetEnvironment: config.get('MOMO_TARGET_ENVIRONMENT', { infer: true }),
      subscriptionKey: config.get('MOMO_PRY_KEY', { infer: true }),
      apiUser: config.get('MOMO_API_USER_ID', { infer: true }),
      apiKey: config.get('MOMO_API_KEY', { infer: true }),
      notConfiguredMessage: 'Mobile Money payments are not configured yet',
    });
  }

  async requestToPay(input: {
    referenceId: string;
    amount: number;
    msisdn: string;
    externalId: string;
    message: string;
  }): Promise<void> {
    await this.client.submit(
      '/collection/v1_0/requesttopay',
      input.referenceId,
      {
        amount: String(input.amount),
        currency: this.config.get('MOMO_COLLECTION_CURRENCY', { infer: true }),
        externalId: input.externalId,
        payer: { partyIdType: 'MSISDN', partyId: input.msisdn },
        payerMessage: input.message,
        payeeNote: input.message,
      },
      callbackUrl(
        this.config.get('MOMO_CALLBACK_URL', { infer: true }),
        input.externalId,
      ),
    );
  }

  async getStatus(referenceId: string): Promise<ProviderPaymentStatus> {
    const raw = await this.client.status(
      `/collection/v1_0/requesttopay/${referenceId}`,
    );
    switch (raw.status) {
      case 'SUCCESSFUL':
        return {
          status: 'SUCCESSFUL',
          transactionId: raw.financialTransactionId,
        };
      case 'FAILED':
        return { status: 'FAILED', reason: describeFailure(raw.code ?? '') };
      default:
        return { status: raw.status };
    }
  }
}

/** MTN's failure codes, in words a payer can act on. Unknown codes get a generic message. */
const FAILURE_MESSAGES: Record<string, string> = {
  NOT_ENOUGH_FUNDS: 'Your MoMo balance is too low for this payment.',
  PAYER_LIMIT_REACHED: 'This payment is over your MoMo transaction limit.',
  PAYER_NOT_FOUND: "This number isn't registered for MTN Mobile Money.",
  NOT_ALLOWED: "This number can't make MoMo payments right now.",
  APPROVAL_REJECTED: 'The payment was declined on your phone.',
  TRANSACTION_CANCELED: 'The payment was cancelled on your phone.',
  EXPIRED: 'The payment request expired before it was approved.',
  TIMEOUT: 'The payment request expired before it was approved.',
  REJECTED: 'The payment was declined on your phone.',
};

export function describeFailure(code: string): string {
  return FAILURE_MESSAGES[code] ?? 'MoMo could not complete the payment.';
}
