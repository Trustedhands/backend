import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../../config/env.js';
import type { Prisma, TicketStatus } from '../../../generated/prisma/client.js';
import {
  ConflictError,
  NotFoundError,
} from '../../../shared/domain/domain-error.js';
import { PrismaService } from '../../../shared/database/prisma.service.js';
import {
  formatRequestRef,
  formatTicketRef,
} from '../../../shared/http/references.js';
import { AuditLog } from '../../../shared/audit/audit-log.js';
import { Mailer } from '../../auth/application/ports.js';
import { ticketReplyEmail } from './support-emails.js';
import {
  assertTransition,
  deriveSubject,
  validateAttachments,
  validateDescription,
  type UploadedFile,
} from '../domain/ticket.js';
import type {
  AdminTicketPage,
  AdminTicketView,
  TicketView,
} from '../presentation/support.dto.js';

const ticketInclude = {
  serviceRequest: {
    select: {
      id: true,
      number: true,
      category: true,
      scheduledAt: true,
      serviceType: { select: { label: true } },
    },
  },
  // Never load file contents for listings
  attachments: {
    select: { id: true, filename: true, contentType: true, sizeBytes: true },
    orderBy: { createdAt: 'asc' },
  },
} satisfies Prisma.SupportTicketInclude;

const entryInclude = {
  orderBy: { createdAt: 'asc' },
  select: {
    id: true,
    body: true,
    createdAt: true,
    author: { select: { id: true, fullName: true } },
  },
} as const;

const adminInclude = {
  ...ticketInclude,
  assignedTo: { select: { id: true, fullName: true } },
  notes: entryInclude,
  messages: entryInclude,
  client: {
    select: {
      id: true,
      fullName: true,
      user: { select: { email: true, phone: true } },
    },
  },
} satisfies Prisma.SupportTicketInclude;

type TicketRow = Prisma.SupportTicketGetPayload<{
  include: typeof ticketInclude;
}>;
type AdminTicketRow = Prisma.SupportTicketGetPayload<{
  include: typeof adminInclude;
}>;

@Injectable()
export class SupportService {
  private readonly logger = new Logger(SupportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailer: Mailer,
    private readonly config: ConfigService<Env, true>,
    private readonly audit: AuditLog,
  ) {}

  /** "Report an issue" */
  async create(
    clientId: string,
    input: { description: string; serviceRequestId?: string },
    files: UploadedFile[],
  ): Promise<TicketView> {
    const description = validateDescription(input.description);
    const attachments = validateAttachments(files);
    if (input.serviceRequestId) {
      const owned = await this.prisma.serviceRequest.count({
        where: { id: input.serviceRequestId, clientId },
      });
      if (!owned)
        throw new NotFoundError(
          'service_request_not_found',
          'Request not found',
        );
    }

    const ticket = await this.prisma.supportTicket.create({
      data: {
        clientId,
        serviceRequestId: input.serviceRequestId ?? null,
        subject: deriveSubject(description),
        description,
        attachments: {
          create: attachments.map((a) => ({
            filename: a.filename,
            contentType: a.contentType,
            sizeBytes: a.data.length,
            data: new Uint8Array(a.data),
          })),
        },
      },
      include: adminInclude,
    });
    await this.notifyOps(ticket);
    return toView(ticket);
  }

  async listForClient(clientId: string): Promise<TicketView[]> {
    const rows = await this.prisma.supportTicket.findMany({
      where: { clientId },
      orderBy: { createdAt: 'desc' },
      include: ticketInclude,
      take: 100,
    });
    return rows.map(toView);
  }

  async listForAdmin(filter: {
    status?: TicketStatus;
    skip: number;
    take: number;
  }): Promise<AdminTicketPage> {
    const where: Prisma.SupportTicketWhereInput = filter.status
      ? { status: filter.status }
      : {};
    const [rows, total] = await Promise.all([
      this.prisma.supportTicket.findMany({
        where,
        // Oldest unresolved first
        orderBy: { createdAt: 'asc' },
        include: adminInclude,
        skip: filter.skip,
        take: filter.take,
      }),
      this.prisma.supportTicket.count({ where }),
    ]);
    return { items: rows.map(toAdminView), total };
  }

  async getForAdmin(id: string): Promise<AdminTicketView> {
    const row = await this.prisma.supportTicket.findUnique({
      where: { id },
      include: adminInclude,
    });
    if (!row) throw new NotFoundError('ticket_not_found', 'Ticket not found');
    return toAdminView(row);
  }

  async update(
    actorId: string,
    id: string,
    input: {
      status?: TicketStatus;
      subject?: string;
      assignedToId?: string | null;
    },
  ): Promise<AdminTicketView> {
    const current = await this.prisma.supportTicket.findUnique({
      where: { id },
      select: { status: true },
    });
    if (!current)
      throw new NotFoundError('ticket_not_found', 'Ticket not found');
    if (input.status) assertTransition(current.status, input.status);
    if (input.assignedToId) {
      const staff = await this.prisma.profile.count({
        where: { id: input.assignedToId, role: 'ADMIN', staffDisabledAt: null },
      });
      if (!staff)
        throw new NotFoundError(
          'staff_not_found',
          'That team member does not exist',
        );
    }
    await this.prisma.supportTicket.update({
      where: { id },
      data: {
        subject: input.subject?.trim(),
        assignedToId: input.assignedToId,
        status: input.status,
        ...(input.status && input.status !== current.status
          ? { closedAt: input.status === 'CLOSED' ? new Date() : null }
          : {}),
      },
    });
    await this.audit.record({
      actorId,
      action: 'ticket.updated',
      entityType: 'ticket',
      entityId: id,
      data: { ...input },
    });
    return this.getForAdmin(id);
  }

  /** Staff-only note */
  async addNote(
    actorId: string,
    id: string,
    body: string,
  ): Promise<AdminTicketView> {
    await this.requireTicket(id);
    await this.prisma.ticketNote.create({
      data: { ticketId: id, authorId: actorId, body: body.trim() },
    });
    return this.getForAdmin(id);
  }

  /** Emails the client and logs the reply; picks up an open ticket. */
  async reply(
    actorId: string,
    id: string,
    body: string,
  ): Promise<AdminTicketView> {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id },
      include: adminInclude,
    });
    if (!ticket)
      throw new NotFoundError('ticket_not_found', 'Ticket not found');
    if (ticket.status === 'CLOSED') {
      throw new ConflictError(
        'ticket_closed',
        'Reopen the ticket before replying',
      );
    }
    const author = await this.prisma.profile.findUniqueOrThrow({
      where: { id: actorId },
      select: { fullName: true },
    });
    // Send first: a reply that never reached the client must not be logged as sent
    await this.mailer.send(
      ticketReplyEmail(
        ticket.client.user.email,
        ticket.client.fullName,
        formatTicketRef(ticket.number),
        ticket.subject,
        body.trim(),
        author.fullName,
      ),
    );
    await this.prisma.$transaction(async (tx) => {
      await tx.ticketMessage.create({
        data: { ticketId: id, authorId: actorId, body: body.trim() },
      });
      if (ticket.status === 'OPEN') {
        await tx.supportTicket.update({
          where: { id },
          data: {
            status: 'ACTIVE',
            assignedToId: ticket.assignedToId ?? actorId,
          },
        });
      }
    });
    return this.getForAdmin(id);
  }

  private async requireTicket(id: string): Promise<void> {
    if (!(await this.prisma.supportTicket.count({ where: { id } }))) {
      throw new NotFoundError('ticket_not_found', 'Ticket not found');
    }
  }

  /** File contents; clients can only fetch their own tickets' files. */
  async attachment(
    ticketId: string,
    attachmentId: string,
    viewer: { id: string; isAdmin: boolean },
  ): Promise<{ filename: string; contentType: string; data: Buffer }> {
    const file = await this.prisma.ticketAttachment.findFirst({
      where: {
        id: attachmentId,
        ticketId,
        ...(viewer.isAdmin ? {} : { ticket: { clientId: viewer.id } }),
      },
    });
    if (!file)
      throw new NotFoundError('attachment_not_found', 'File not found');
    return {
      filename: file.filename,
      contentType: file.contentType,
      data: Buffer.from(file.data),
    };
  }

  /** Lets the ops inbox know about a new report. Never fails the request. */
  private async notifyOps(ticket: AdminTicketRow): Promise<void> {
    const inbox = this.config.get('SUPPORT_INBOX', { infer: true });
    if (!inbox) return;
    const ref = formatTicketRef(ticket.number);
    const lines = [
      `${ref} from ${ticket.client.fullName} (${ticket.client.user.email}${ticket.client.user.phone ? `, ${ticket.client.user.phone}` : ''})`,
      ticket.serviceRequest
        ? `About ${formatRequestRef(ticket.serviceRequest.number)}`
        : 'Not about a specific booking',
      '',
      ticket.description,
      ticket.attachments.length
        ? `\n${ticket.attachments.length} attachment(s) in the admin console.`
        : '',
    ];
    const text = lines.join('\n');
    try {
      await this.mailer.send({
        to: inbox,
        subject: `New report ${ref}: ${ticket.subject}`,
        text,
        html: `<pre style="font-family:Arial,sans-serif;white-space:pre-wrap">${escapeHtml(text)}</pre>`,
      });
    } catch (error) {
      this.logger.error(
        `Support inbox notification failed for ${ref}: ${(error as Error).message}`,
      );
    }
  }
}

function toView(row: TicketRow): TicketView {
  return {
    id: row.id,
    reference: formatTicketRef(row.number),
    subject: row.subject,
    description: row.description,
    status: row.status,
    serviceRequest: row.serviceRequest
      ? {
          id: row.serviceRequest.id,
          reference: formatRequestRef(row.serviceRequest.number),
          category: row.serviceRequest.category,
          categoryLabel: row.serviceRequest.serviceType.label,
          scheduledAt: row.serviceRequest.scheduledAt,
        }
      : null,
    attachments: row.attachments,
    createdAt: row.createdAt,
    closedAt: row.closedAt,
  };
}

function toAdminView(row: AdminTicketRow): AdminTicketView {
  const entry = (e: AdminTicketRow['notes'][number]) => ({
    id: e.id,
    author: e.author,
    body: e.body,
    at: e.createdAt,
  });
  return {
    ...toView(row),
    assignedTo: row.assignedTo,
    notes: row.notes.map(entry),
    replies: row.messages.map(entry),
    client: {
      id: row.client.id,
      fullName: row.client.fullName,
      email: row.client.user.email,
      phone: row.client.user.phone,
    },
  };
}

const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!,
  );
