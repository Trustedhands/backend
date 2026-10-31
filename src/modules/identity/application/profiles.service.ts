import { Injectable } from '@nestjs/common';
import type { Profile } from '../../../generated/prisma/client.js';
import type { AuthUser } from '../../../shared/auth/auth-user.js';
import {
  ConflictError,
  InvalidInputError,
} from '../../../shared/domain/domain-error.js';
import { PrismaService } from '../../../shared/database/prisma.service.js';
import type { AddressDto } from '../../../shared/http/address.dto.js';
import { loadAuthUsers } from '../infrastructure/auth-users.js';
import type {
  CreateProfileDto,
  MeView,
  ProfileView,
  UpdateProfileDto,
} from '../presentation/profile.dto.js';

@Injectable()
export class ProfilesService {
  constructor(private readonly prisma: PrismaService) {}

  async me(user: AuthUser): Promise<MeView> {
    const [profile, auth, home] = await Promise.all([
      this.prisma.profile.findUnique({ where: { id: user.id } }),
      loadAuthUsers(this.prisma, [user.id]).then((m) => m.get(user.id)),
      this.prisma.address.findFirst({
        where: { profileId: user.id, isDefault: true },
      }),
    ]);
    return {
      id: user.id,
      email: auth?.email ?? user.email,
      phone: auth?.phone ?? user.phone,
      emailVerified: Boolean(auth?.emailConfirmedAt),
      phoneVerified: Boolean(auth?.phoneConfirmedAt),
      onboarded: profile !== null,
      profile: profile ? toProfileView(profile) : null,
      homeAddress: home
        ? {
            district: home.district,
            sector: home.sector,
            street: home.street,
            latitude: home.latitude,
            longitude: home.longitude,
          }
        : null,
    };
  }

  async create(user: AuthUser, dto: CreateProfileDto): Promise<MeView> {
    const existing = await this.prisma.profile.findUnique({
      where: { id: user.id },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictError('profile_exists', 'Your profile already exists');
    }
    await this.prisma.profile.create({
      data: {
        id: user.id,
        accountType: dto.accountType,
        fullName: dto.fullName.trim(),
        companyName:
          dto.accountType === 'COMPANY' ? dto.companyName?.trim() : null,
      },
    });
    return this.me(user);
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

  /** Clients must finish sign-up step 1 before using the rest of the app. */
  async require(userId: string): Promise<Profile> {
    const profile = await this.prisma.profile.findUnique({
      where: { id: userId },
    });
    if (!profile) {
      throw new ConflictError('profile_required', 'Finish signing up first');
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
