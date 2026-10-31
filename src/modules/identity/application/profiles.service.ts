import { Injectable } from '@nestjs/common';
import type { Profile } from '../../../generated/prisma/client.js';
import type { AuthUser } from '../../../shared/auth/auth-user.js';
import {
  InvalidInputError,
  NotFoundError,
} from '../../../shared/domain/domain-error.js';
import { PrismaService } from '../../../shared/database/prisma.service.js';
import type { AddressDto } from '../../../shared/http/address.dto.js';
import { maskMsisdn } from '../../payments/domain/msisdn.js';
import type {
  MeView,
  ProfileView,
  UpdateProfileDto,
} from '../presentation/profile.dto.js';

@Injectable()
export class ProfilesService {
  constructor(private readonly prisma: PrismaService) {}

  async me(user: AuthUser): Promise<MeView> {
    const [account, home, methods] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: user.id },
        include: { profile: true },
      }),
      this.prisma.address.findFirst({
        where: { profileId: user.id, isDefault: true },
      }),
      this.prisma.savedPaymentMethod.findMany({
        where: { profileId: user.id },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
      }),
    ]);
    if (!account?.profile) {
      throw new NotFoundError('account_not_found', 'Account not found');
    }
    return {
      id: user.id,
      email: account.email,
      phone: account.phone,
      emailVerified: account.emailVerifiedAt !== null,
      phoneVerified: account.phoneVerifiedAt !== null,
      profile: toProfileView(account.profile),
      homeAddress: home
        ? {
            district: home.district,
            sector: home.sector,
            street: home.street,
            latitude: home.latitude,
            longitude: home.longitude,
          }
        : null,
      paymentMethods: methods.map((m) => ({
        id: m.id,
        msisdn: m.msisdn,
        msisdnMasked: maskMsisdn(m.msisdn),
        isDefault: m.isDefault,
      })),
    };
  }

  async update(user: AuthUser, dto: UpdateProfileDto): Promise<MeView> {
    const profile = await this.require(user.id);
    const accountType = dto.accountType ?? profile.accountType;
    const companyName =
      dto.companyName !== undefined
        ? dto.companyName.trim()
        : profile.companyName;
    if (accountType === 'COMPANY' && !companyName) {
      throw new InvalidInputError(
        'company_name_required',
        'Company accounts need a company name',
      );
    }
    await this.prisma.profile.update({
      where: { id: user.id },
      data: {
        ...dto,
        fullName: dto.fullName?.trim(),
        companyName: accountType === 'COMPANY' ? companyName : null,
      },
    });
    return this.me(user);
  }

  async setHomeAddress(user: AuthUser, dto: AddressDto): Promise<MeView> {
    await this.require(user.id);
    const data = {
      district: dto.district.trim(),
      sector: dto.sector.trim(),
      street: dto.street.trim(),
      latitude: dto.latitude ?? null,
      longitude: dto.longitude ?? null,
    };
    await this.prisma.$transaction(async (tx) => {
      const home = await tx.address.findFirst({
        where: { profileId: user.id, isDefault: true },
      });
      if (home) {
        await tx.address.update({ where: { id: home.id }, data });
      } else {
        await tx.address.create({
          data: { ...data, profileId: user.id, label: 'Home', isDefault: true },
        });
      }
    });
    return this.me(user);
  }

  /** Every account gets a profile at registration; this guards stale tokens. */
  async require(userId: string): Promise<Profile> {
    const profile = await this.prisma.profile.findUnique({
      where: { id: userId },
    });
    if (!profile) {
      throw new NotFoundError('account_not_found', 'Account not found');
    }
    return profile;
  }
}

function toProfileView(p: Profile): ProfileView {
  return {
    role: p.role,
    accountType: p.accountType,
    fullName: p.fullName,
    companyName: p.companyName,
    gender: p.gender,
    birthDay: p.birthDay,
    birthMonth: p.birthMonth,
    nationality: p.nationality,
    countryOfResidence: p.countryOfResidence,
    occupation: p.occupation,
    preferredLanguages: p.preferredLanguages,
    kycStatus: p.kycStatus,
    pushEnabled: p.pushEnabled,
  };
}
