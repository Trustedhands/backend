import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'node:crypto';
import type { Env } from '../../../config/env.js';
import { Prisma, type StaffRole } from '../../../generated/prisma/client.js';
import { AuditLog } from '../../../shared/audit/audit-log.js';
import { ROLE_PERMISSIONS } from '../../../shared/auth/permissions.js';
import {
  ConflictError,
  ForbiddenError,
  InvalidInputError,
  NotFoundError,
} from '../../../shared/domain/domain-error.js';
import { PrismaService } from '../../../shared/database/prisma.service.js';
import { Mailer } from '../../auth/application/ports.js';
import {
  type IssuedSession,
  Sessions,
} from '../../auth/application/sessions.service.js';
import {
  assertPasswordPolicy,
  normalizeEmail,
  normalizeRwandaPhone,
} from '../../auth/domain/credentials.js';
import { PasswordHasher } from '../../auth/infrastructure/password-hasher.js';
import type {
  InvitationPreviewView,
  StaffMeView,
  TeamView,
} from '../presentation/team.dto.js';
import { invitationEmail } from './team-emails.js';

const INVITE_TTL_DAYS = 7;
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export const STAFF_ROLE_LABELS: Record<StaffRole, string> = {
  SUPER_ADMIN: 'Super admin',
  VERIFICATION_LEAD: 'Verification lead',
  FINANCE: 'Finance',
  CUSTOMER_SERVICE: 'Customer service',
};

@Injectable()
export class TeamService {
  private readonly logger = new Logger(TeamService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLog,
    private readonly mailer: Mailer,
    private readonly hasher: PasswordHasher,
    private readonly sessions: Sessions,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async me(userId: string): Promise<StaffMeView> {
    const profile = await this.prisma.profile.findUniqueOrThrow({
      where: { id: userId },
      include: { user: { select: { email: true } } },
    });
    return {
      id: profile.id,
      fullName: profile.fullName,
      email: profile.user.email,
      staffRole: profile.staffRole!,
      permissions: [...ROLE_PERMISSIONS[profile.staffRole!]],
    };
  }

  async team(): Promise<TeamView> {
    const [members, invitations] = await Promise.all([
      this.prisma.profile.findMany({
        where: { role: 'ADMIN' },
        include: { user: { select: { email: true, lastActiveAt: true } } },
        orderBy: { fullName: 'asc' },
      }),
      this.prisma.staffInvitation.findMany({
        where: {
          acceptedAt: null,
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    const inviters = await this.names(invitations.map((i) => i.invitedById));
    return {
      members: members.map((m) => ({
        id: m.id,
        fullName: m.fullName,
        email: m.user.email,
        staffRole: m.staffRole!,
        disabled: m.staffDisabledAt !== null,
        lastActiveAt: m.user.lastActiveAt,
      })),
      pendingInvitations: invitations.map((i) => ({
        id: i.id,
        email: i.email,
        staffRole: i.staffRole,
        invitedBy: inviters.get(i.invitedById) ?? 'Former staff',
        expiresAt: i.expiresAt,
        createdAt: i.createdAt,
      })),
    };
  }

  async invite(
    actorId: string,
    emailInput: string,
    staffRole: StaffRole,
  ): Promise<TeamView> {
    const email = normalizeEmail(emailInput);
    if (await this.prisma.user.count({ where: { email } })) {
      throw new ConflictError(
        'email_in_use',
        'This email already has an account. Use a separate work email for staff.',
      );
    }
    const token = randomBytes(32).toString('base64url');
    const inviter = await this.prisma.profile.findUniqueOrThrow({
      where: { id: actorId },
    });
    await this.prisma.$transaction(async (tx) => {
      // A new invitation replaces any pending one for the same address
      await tx.staffInvitation.updateMany({
        where: { email, acceptedAt: null, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      const invitation = await tx.staffInvitation.create({
        data: {
          email,
          staffRole,
          tokenHash: sha256(token),
          invitedById: actorId,
          expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 864e5),
        },
      });
      await this.audit.record(
        {
          actorId,
          action: 'team.invited',
          entityType: 'team',
          entityId: invitation.id,
          data: { email, staffRole },
        },
        tx,
      );
    });
    const link = `${this.config.get('ADMIN_APP_URL', { infer: true }).replace(/\/$/, '')}/accept-invite?token=${token}`;
    await this.mailer.send(
      invitationEmail(
        email,
        inviter.fullName,
        STAFF_ROLE_LABELS[staffRole],
        link,
        INVITE_TTL_DAYS,
      ),
    );
    return this.team();
  }

  async revokeInvitation(actorId: string, id: string): Promise<TeamView> {
    const { count } = await this.prisma.staffInvitation.updateMany({
      where: { id, acceptedAt: null, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (!count)
      throw new NotFoundError('invitation_not_found', 'Invitation not found');
    await this.audit.record({
      actorId,
      action: 'team.invitation_revoked',
      entityType: 'team',
      entityId: id,
    });
    return this.team();
  }

  async updateMember(
    actorId: string,
    memberId: string,
    input: { staffRole?: StaffRole; disabled?: boolean },
  ): Promise<TeamView> {
    if (memberId === actorId) {
      throw new ForbiddenError(
        'cannot_change_self',
        "You can't change your own role or access",
      );
    }
    await this.prisma.$transaction(async (tx) => {
      const member = await tx.profile.findUnique({ where: { id: memberId } });
      if (!member || member.role !== 'ADMIN')
        throw new NotFoundError('staff_not_found', 'Team member not found');

      const losesSuperAdmin =
        member.staffRole === 'SUPER_ADMIN' &&
        !member.staffDisabledAt &&
        ((input.staffRole && input.staffRole !== 'SUPER_ADMIN') ||
          input.disabled === true);
      if (losesSuperAdmin) {
        const others = await tx.profile.count({
          where: {
            role: 'ADMIN',
            staffRole: 'SUPER_ADMIN',
            staffDisabledAt: null,
            id: { not: memberId },
          },
        });
        if (!others)
          throw new ConflictError(
            'last_super_admin',
            'There must always be at least one super admin',
          );
      }

      await tx.profile.update({
        where: { id: memberId },
        data: {
          staffRole: input.staffRole,
          ...(input.disabled === undefined
            ? {}
            : { staffDisabledAt: input.disabled ? new Date() : null }),
        },
      });
      if (input.disabled) {
        // Sign them out everywhere
        await tx.refreshToken.updateMany({
          where: { userId: memberId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      await this.audit.record(
        {
          actorId,
          action: 'team.member_updated',
          entityType: 'team',
          entityId: memberId,
          data: { ...input },
        },
        tx,
      );
    });
    return this.team();
  }

  async previewInvitation(token: string): Promise<InvitationPreviewView> {
    const invitation = await this.findUsable(token);
    const inviter = await this.names([invitation.invitedById]);
    return {
      email: invitation.email,
      staffRole: invitation.staffRole,
      invitedBy: inviter.get(invitation.invitedById) ?? 'TrustedHands',
    };
  }

  /** Creates the staff account; the emailed link proves inbox ownership. */
  async acceptInvitation(
    input: { token: string; fullName: string; password: string; phone: string },
    userAgent: string | null,
  ): Promise<IssuedSession> {
    const invitation = await this.findUsable(input.token);
    assertPasswordPolicy(input.password);
    const phone = normalizeRwandaPhone(input.phone);
    const passwordHash = await this.hasher.hash(input.password);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const { count } = await tx.staffInvitation.updateMany({
          where: { id: invitation.id, acceptedAt: null, revokedAt: null },
          data: { acceptedAt: new Date() },
        });
        if (!count) throw invalidInvitation();
        const user = await tx.user.create({
          data: {
            email: invitation.email,
            passwordHash,
            phone,
            emailVerifiedAt: new Date(),
            profile: {
              create: {
                fullName: input.fullName.trim(),
                role: 'ADMIN',
                staffRole: invitation.staffRole,
              },
            },
          },
        });
        await this.audit.record(
          {
            actorId: user.id,
            action: 'team.joined',
            entityType: 'team',
            entityId: user.id,
            data: { staffRole: invitation.staffRole },
          },
          tx,
        );
        return this.sessions.start(user.id, userAgent, tx);
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictError(
          'email_in_use',
          'This email already has an account',
        );
      }
      throw error;
    }
  }

  private async findUsable(token: string) {
    const invitation = await this.prisma.staffInvitation.findUnique({
      where: { tokenHash: sha256(token) },
    });
    if (
      !invitation ||
      invitation.acceptedAt ||
      invitation.revokedAt ||
      invitation.expiresAt < new Date()
    ) {
      throw invalidInvitation();
    }
    return invitation;
  }

  private async names(ids: string[]): Promise<Map<string, string>> {
    const rows = await this.prisma.profile.findMany({
      where: { id: { in: [...new Set(ids)] } },
      select: { id: true, fullName: true },
    });
    return new Map(rows.map((r) => [r.id, r.fullName]));
  }
}

const invalidInvitation = () =>
  new InvalidInputError(
    'invalid_invitation',
    'This invitation link is invalid or has expired. Ask for a new one.',
  );
