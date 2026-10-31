import { ApiProperty } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { StaffRole } from '../../../generated/prisma/enums.js';
import {
  PERMISSIONS,
  type Permission,
} from '../../../shared/auth/permissions.js';

export class StaffMeView {
  id: string;
  fullName: string;
  email: string;
  @ApiProperty({ enum: StaffRole })
  staffRole: StaffRole;
  @ApiProperty({ enum: PERMISSIONS, isArray: true })
  permissions: Permission[];
}

export class StaffMemberView {
  id: string;
  fullName: string;
  email: string;
  @ApiProperty({ enum: StaffRole })
  staffRole: StaffRole;
  disabled: boolean;
  lastActiveAt: Date | null;
}

export class InvitationView {
  id: string;
  email: string;
  @ApiProperty({ enum: StaffRole })
  staffRole: StaffRole;
  invitedBy: string;
  expiresAt: Date;
  createdAt: Date;
}

export class TeamView {
  members: StaffMemberView[];
  pendingInvitations: InvitationView[];
}

export class InviteDto {
  @IsEmail()
  email: string;

  @ApiProperty({ enum: StaffRole })
  @IsEnum(StaffRole)
  staffRole: StaffRole;
}

export class UpdateStaffDto {
  @ApiProperty({ enum: StaffRole, required: false })
  @IsOptional()
  @IsEnum(StaffRole)
  staffRole?: StaffRole;

  /** Remove (true) or restore (false) admin access */
  @IsOptional()
  @IsBoolean()
  disabled?: boolean;
}

/** Shown on the accept-invite page before the account exists. */
export class InvitationPreviewView {
  email: string;
  @ApiProperty({ enum: StaffRole })
  staffRole: StaffRole;
  invitedBy: string;
}

export class AcceptInvitationDto {
  @IsString()
  @MinLength(20)
  token: string;

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  fullName: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password: string;

  /** Rwandan mobile number */
  @IsString()
  @MaxLength(20)
  phone: string;
}
