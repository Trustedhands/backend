import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.js';
import { AuthService } from './application/auth.service.js';
import { Mailer, SmsSender } from './application/ports.js';
import { Sessions } from './application/sessions.service.js';
import { VerificationCodes } from './application/verification-codes.service.js';
import { AfricasTalkingSmsSender } from './infrastructure/africas-talking.sms.js';
import { LogMailer, LogSmsSender } from './infrastructure/log-senders.js';
import { PasswordHasher } from './infrastructure/password-hasher.js';
import { ResendMailer } from './infrastructure/resend.mailer.js';
import { AuthController } from './presentation/auth.controller.js';

@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    Sessions,
    VerificationCodes,
    PasswordHasher,
    {
      provide: Mailer,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        config.get('EMAIL_PROVIDER', { infer: true }) === 'resend'
          ? new ResendMailer(config)
          : new LogMailer(),
    },
    {
      provide: SmsSender,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        config.get('SMS_PROVIDER', { infer: true }) === 'africastalking'
          ? new AfricasTalkingSmsSender(config)
          : new LogSmsSender(),
    },
  ],
  exports: [Mailer, SmsSender, PasswordHasher, Sessions],
})
export class AuthAccountsModule {}
