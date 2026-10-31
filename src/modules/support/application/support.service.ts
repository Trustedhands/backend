import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../../config/env.js';
import type { Prisma, TicketStatus } from '../../../generated/prisma/client.js';
import { NotFoundError } from '../../../shared/domain/domain-error.js';
import { PrismaService } from '../../../shared/database/prisma.service.js';
import {
  formatRequestRef,
  formatTicketRef,
} from '../../../shared/http/references.js';
import { Mailer } from '../../auth/application/ports.js';
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
    select: { id: true, number: true, category: true, scheduledAt: true },
  },
  // Never load file contents for listings
  attachments: {
    select: { id: true, filename: true, contentType: true, sizeBytes: true },
    orderBy: { createdAt: 'asc' },
  },
} satisfies Prisma.SupportTicketInclude;

const adminInclude = {
  ...ticketInclude,
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
    id: string,
    input: { status?: TicketStatus; subject?: string },
  ): Promise<AdminTicketView> {
    const current = await this.prisma.supportTicket.findUnique({
      where: { id },
      select: { status: true },
    });
    if (!current)
      throw new NotFoundError('ticket_not_found', 'Ticket not found');
    if (input.status) assertTransition(current.status, input.status);
    await this.prisma.supportTicket.update({
      where: { id },
      data: {
        subject: input.subject?.trim(),
        status: input.status,
        ...(input.status && input.status !== current.status
          ? { closedAt: input.status === 'CLOSED' ? new Date() : null }
          : {}),
      },
    });
    return this.getForAdmin(id);
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
          scheduledAt: row.serviceRequest.scheduledAt,
        }
      : null,
    attachments: row.attachments,
    createdAt: row.createdAt,
    closedAt: row.closedAt,
  };
}

function toAdminView(row: AdminTicketRow): AdminTicketView {
  return {
    ...toView(row),
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
