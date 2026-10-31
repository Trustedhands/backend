import { Body, Controller, Get, Patch, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../../../shared/auth/auth-user.js';
import { CurrentUser } from '../../../shared/auth/decorators.js';
import { AddressDto } from '../../../shared/http/address.dto.js';
import { ProfilesService } from '../application/profiles.service.js';
import { CreateProfileDto, MeView, UpdateProfileDto } from './profile.dto.js';

@ApiTags('me')
@ApiBearerAuth()
@Controller('me')
export class MeController {
  constructor(private readonly profiles: ProfilesService) {}

  @Get()
  me(@CurrentUser() user: AuthUser): Promise<MeView> {
    return this.profiles.me(user);
  }

  @Post('profile')
  createProfile(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateProfileDto,
  ): Promise<MeView> {
    return this.profiles.create(user, dto);
  }

  @Patch('profile')
  updateProfile(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateProfileDto,
  ): Promise<MeView> {
    return this.profiles.update(user, dto);
  }

  @Put('home-address')
  setHomeAddress(
    @CurrentUser() user: AuthUser,
    @Body() dto: AddressDto,
  ): Promise<MeView> {
    return this.profiles.setHomeAddress(user, dto);
  }
}
