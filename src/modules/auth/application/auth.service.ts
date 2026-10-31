import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client.js';
import type { AccountType } from '../../../generated/prisma/enums.js';
import {
  ConflictError,
  InvalidInputError,
  UnauthorizedError,
} from '../../../shared/domain/domain-error.js';
import { PrismaService } from '../../../shared/database/prisma.service.js';
import {
  assertPasswordPolicy,
  normalizeEmail,
  normalizeRwandaPhone,
} from '../domain/credentials.js';
import { PasswordHasher } from '../infrastructure/password-hasher.js';
import {
  emailVerificationEmail,
  passwordChangedEmail,
  passwordResetEmail,
} from './auth-emails.js';
import { Mailer, SmsSender } from './ports.js';
import { type IssuedSession, Sessions } from './sessions.service.js';
import {
  CODE_TTL_MINUTES,
  VerificationCodes,
} from './verification-codes.service.js';

export interface RegisterInput {
  email: string;
  password: string;
  phone: string;
  fullName: string;
  accountType: AccountType;
  companyName?: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly hasher: PasswordHasher,
    private readonly sessions: Sessions,
    private readonly codes: VerificationCodes,
    private readonly mailer: Mailer,
    private readonly sms: SmsSender,
  ) {}

  /** Creates the account and its client profile, sends an email code, and signs in. */
  async register(
    input: RegisterInput,
    userAgent: string | null,
  ): Promise<IssuedSession> {
    const email = normalizeEmail(input.email);
    const phone = normalizeRwandaPhone(input.phone);
    assertPasswordPolicy(input.password);
    const fullName = input.fullName.trim();
    if (input.accountType === 'COMPANY' && !input.companyName?.trim()) {
      throw new InvalidInputError(
        'company_name_required',
        'Company accounts need a company name',
      );
    }
    const passwordHash = await this.hasher.hash(input.password);

    let result: { session: IssuedSession; code: string };
    try {
      result = await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            email,
            passwordHash,
            phone,
            profile: {
              create: {
                fullName,
                accountType: input.accountType,
                companyName:
                  input.accountType === 'COMPANY'
                    ? input.companyName!.trim()
                    : null,
              },
            },
          },
        });
        const code = await this.codes.issue(user.id, 'EMAIL_VERIFY', email, tx);
        const session = await this.sessions.start(user.id, userAgent, tx);
        return { session, code };
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictError(
          'email_taken',
          'An account with this email already exists. Log in instead.',
        );
      }
      throw error;
    }

    // The account exists either way; if this fails the user can ask for a new code
    await this.mailer
      .send(
        emailVerificationEmail(email, fullName, result.code, CODE_TTL_MINUTES),
      )
      .catch((e: Error) =>
        this.logger.error(
          `Verification email to new user failed: ${e.message}`,
        ),
      );
    return result.session;
  }

  async login(
    emailInput: string,
    password: string,
    userAgent: string | null,
  ): Promise<IssuedSession> {
    const user = await this.prisma.user.findUnique({
      where: { email: normalizeEmail(emailInput) },
    });
    if (!user) {
      await this.hasher.dummyVerify(password);
      throw invalidCredentials();
    }
    if (!(await this.hasher.verify(password, user.passwordHash)))
      throw invalidCredentials();
    return this.sessions.start(user.id, userAgent);
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
    userAgent: string | null,
  ): Promise<IssuedSession> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { profile: true },
    });
    if (!(await this.hasher.verify(currentPassword, user.passwordHash))) {
      throw new InvalidInputError(
        'wrong_password',
        'Your current password is not right',
      );
    }
    assertPasswordPolicy(newPassword);
    const passwordHash = await this.hasher.hash(newPassword);
    const session = await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { passwordHash } });
      await this.sessions.endAll(userId, tx);
      return this.sessions.start(userId, userAgent, tx);
    });
    await this.notifyPasswordChanged(user.email, user.profile?.fullName ?? '');
    return session;
  }

  /** Always succeeds from the caller's view, so it can't be used to find accounts. */
  async requestPasswordReset(emailInput: string): Promise<void> {
    const email = normalizeEmail(emailInput);
    const user = await this.prisma.user.findUnique({
      where: { email },
      include: { profile: true },
    });
    if (!user) return;
    try {
      const code = await this.codes.issue(user.id, 'PASSWORD_RESET', email);
      await this.mailer.send(
        passwordResetEmail(
          email,
          user.profile?.fullName ?? '',
          code,
          CODE_TTL_MINUTES,
        ),
      );
    } catch (error) {
      // A cooldown or delivery failure must look the same as success
      this.logger.warn(
        `Password reset email not sent: ${(error as Error).message}`,
      );
    }
  }

  /** Sets a new password with an emailed code; signs out everywhere and back in here. */
  async resetPassword(
    emailInput: string,
    code: string,
    newPassword: string,
    userAgent: string | null,
  ): Promise<IssuedSession> {
    const email = normalizeEmail(emailInput);
    const user = await this.prisma.user.findUnique({
      where: { email },
      include: { profile: true },
    });
    if (!user)
      throw new InvalidInputError(
        'invalid_code',
        "That code isn't right or has expired. Ask for a new one.",
      );
    assertPasswordPolicy(newPassword);
    const passwordHash = await this.hasher.hash(newPassword);

    // Outside the transaction: a wrong code must still count as an attempt
    await this.codes.consume(user.id, 'PASSWORD_RESET', code);
    const session = await this.prisma.$transaction(async (tx) => {
      // Receiving the code proves control of the inbox
      await tx.user.update({
        where: { id: user.id },
        data: {
          passwordHash,
          emailVerifiedAt: user.emailVerifiedAt ?? new Date(),
        },
      });
      await this.sessions.endAll(user.id, tx);
      return this.sessions.start(user.id, userAgent, tx);
    });
    await this.notifyPasswordChanged(email, user.profile?.fullName ?? '');
    return session;
  }

  async sendEmailCode(userId: string): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { profile: true },
    });
    if (user.emailVerifiedAt)
      throw new ConflictError(
        'already_verified',
        'Your email is already verified',
      );
    const code = await this.codes.issue(userId, 'EMAIL_VERIFY', user.email);
    await this.mailer.send(
      emailVerificationEmail(
        user.email,
        user.profile?.fullName ?? '',
        code,
        CODE_TTL_MINUTES,
      ),
    );
  }

  async verifyEmail(userId: string, code: string): Promise<void> {
    const target = await this.codes.consume(userId, 'EMAIL_VERIFY', code);
    // Only counts if the code went to the address still on the account
    await this.prisma.user.updateMany({
      where: { id: userId, email: target },
      data: { emailVerifiedAt: new Date() },
    });
  }

  async sendPhoneCode(userId: string, phoneInput?: string): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
    });
    const phone = normalizeRwandaPhone(phoneInput ?? user.phone ?? '');
    if (user.phone === phone && user.phoneVerifiedAt) {
      throw new ConflictError(
        'already_verified',
        'This number is already verified',
      );
    }
    await this.assertPhoneAvailable(userId, phone);
    const code = await this.codes.issue(userId, 'PHONE_VERIFY', phone);
    await this.sms.send(
      phone,
      `${code} is your TrustedHands verification code. It expires in ${CODE_TTL_MINUTES} minutes.`,
    );
  }

  async verifyPhone(userId: string, code: string): Promise<void> {
    const phone = await this.codes.consume(userId, 'PHONE_VERIFY', code);
    await this.prisma.$transaction(async (tx) => {
      await this.assertPhoneAvailable(userId, phone, tx);
      await tx.user.update({
        where: { id: userId },
        data: { phone, phoneVerifiedAt: new Date() },
      });
    });
  }

  /** A verified number belongs to one account. */
  private async assertPhoneAvailable(
    userId: string,
    phone: string,
    db: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    const taken = await db.user.count({
      where: { phone, phoneVerifiedAt: { not: null }, id: { not: userId } },
    });
    if (taken)
      throw new ConflictError(
        'phone_taken',
        'This number is already verified on another account',
      );
  }

  private async notifyPasswordChanged(
    email: string,
    name: string,
  ): Promise<void> {
    await this.mailer
      .send(passwordChangedEmail(email, name))
      .catch((e: Error) =>
        this.logger.error(`Password-changed email failed: ${e.message}`),
      );
  }
}

const invalidCredentials = () =>
  new UnauthorizedError('invalid_credentials', 'Wrong email or password');
