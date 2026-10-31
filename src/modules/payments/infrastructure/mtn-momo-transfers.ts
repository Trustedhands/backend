import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../../config/env.js';
import type { ProviderPaymentStatus } from '../application/mobile-money.gateway.js';
import { MoneyTransferGateway } from '../application/money-transfer.gateway.js';
import { callbackUrl, MomoProductClient } from './momo-client.js';

/** MTN MoMo Disbursement: refunds to clients and payouts to workers. */
@Injectable()
export class MtnMomoTransfers extends MoneyTransferGateway {
  private readonly client: MomoProductClient;

  constructor(private readonly config: ConfigService<Env, true>) {
    super();
    this.client = new MomoProductClient({
      product: 'disbursement',
      baseUrl: config.get('MOMO_BASE_URL', { infer: true }),
      targetEnvironment: config.get('MOMO_TARGET_ENVIRONMENT', { infer: true }),
      subscriptionKey: config.get('MOMO_DSB_PRY_KEY', { infer: true }),
      // The API user is shared across MoMo products; only the subscription key differs
      apiUser: config.get('MOMO_API_USER_ID', { infer: true }),
      apiKey: config.get('MOMO_API_KEY', { infer: true }),
      notConfiguredMessage: 'Mobile Money transfers are not configured yet',
    });
  }

  async transfer(input: {
    referenceId: string;
    amount: number;
    msisdn: string;
    externalId: string;
    message: string;
    callbackPath: string;
  }): Promise<void> {
    await this.client.submit(
      '/disbursement/v1_0/transfer',
      input.referenceId,
      {
        amount: String(input.amount),
        currency: this.config.get('MOMO_DISBURSEMENT_CURRENCY', {
          infer: true,
        }),
        externalId: input.externalId,
        payee: { partyIdType: 'MSISDN', partyId: input.msisdn },
        payerMessage: input.message,
        payeeNote: input.message,
      },
      callbackUrl(
        this.config.get('MOMO_DSB_CALLBACK_URL', { infer: true }),
        input.callbackPath,
      ),
    );
  }

  async getTransferStatus(referenceId: string): Promise<ProviderPaymentStatus> {
    const raw = await this.client.status(
      `/disbursement/v1_0/transfer/${referenceId}`,
    );
    switch (raw.status) {
      case 'SUCCESSFUL':
        return {
          status: 'SUCCESSFUL',
          transactionId: raw.financialTransactionId,
        };
      case 'FAILED':
        return {
          status: 'FAILED',
          reason: describeTransferFailure(raw.code ?? ''),
        };
      default:
        return { status: raw.status };
    }
  }
}

/** For staff: why a refund or payout didn't go through. */
const TRANSFER_FAILURES: Record<string, string> = {
  PAYEE_NOT_FOUND: "The number isn't registered for MTN Mobile Money.",
  NOT_ENOUGH_FUNDS:
    'The TrustedHands disbursement account has too little balance. Top it up and try again.',
  PAYER_LIMIT_REACHED: 'The disbursement account has hit its MoMo limit.',
  NOT_ALLOWED: 'MoMo did not allow this transfer.',
  NOT_ALLOWED_TARGET_ENVIRONMENT:
    'MoMo did not allow this transfer in this environment.',
};

export function describeTransferFailure(code: string): string {
  return (
    TRANSFER_FAILURES[code] ??
    `MoMo could not complete the transfer${code ? ` (${code})` : ''}.`
  );
}
