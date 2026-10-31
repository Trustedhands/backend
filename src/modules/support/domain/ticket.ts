import {
  ConflictError,
  InvalidInputError,
} from '../../../shared/domain/domain-error.js';

export type TicketStatus = 'OPEN' | 'ACTIVE' | 'CLOSED';

export const MAX_ATTACHMENTS = 3;
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const MAX_DESCRIPTION = 4000;
const SUBJECT_LENGTH = 60;

/** Ticket title from the report's first line, e.g. "The worker arrived at 10:15 instead of…" */
export function deriveSubject(description: string): string {
  const firstLine = description.trim().split(/\r?\n/)[0]!.trim();
  return firstLine.length <= SUBJECT_LENGTH
    ? firstLine
    : `${firstLine.slice(0, SUBJECT_LENGTH - 1).trimEnd()}…`;
}

export function validateDescription(description: string): string {
  const trimmed = description.trim();
  if (trimmed.length < 10) {
    throw new InvalidInputError(
      'description_too_short',
      'Tell us a bit more about what happened',
    );
  }
  if (trimmed.length > MAX_DESCRIPTION) {
    throw new InvalidInputError(
      'description_too_long',
      `Keep it under ${MAX_DESCRIPTION} characters`,
    );
  }
  return trimmed;
}

const ALLOWED: ReadonlyArray<{
  type: string;
  matches: (b: Buffer) => boolean;
}> = [
  {
    type: 'image/jpeg',
    matches: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    type: 'image/png',
    matches: (b) =>
      b
        .subarray(0, 8)
        .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  {
    type: 'application/pdf',
    matches: (b) => b.subarray(0, 5).toString('latin1') === '%PDF-',
  },
];

/** Identifies an upload by its bytes, ignoring the client's claimed type and name. */
export function detectFileType(bytes: Buffer): string | null {
  return ALLOWED.find((a) => a.matches(bytes))?.type ?? null;
}

export interface UploadedFile {
  originalname: string;
  buffer: Buffer;
  size: number;
}

export interface ValidAttachment {
  filename: string;
  contentType: string;
  data: Buffer;
}

export function validateAttachments(files: UploadedFile[]): ValidAttachment[] {
  if (files.length > MAX_ATTACHMENTS) {
    throw new InvalidInputError(
      'too_many_files',
      `Attach up to ${MAX_ATTACHMENTS} files`,
    );
  }
  return files.map((f) => {
    if (f.size === 0 || f.size > MAX_ATTACHMENT_BYTES) {
      throw new InvalidInputError(
        'file_too_large',
        'Each file must be under 5 MB',
      );
    }
    const contentType = detectFileType(f.buffer);
    if (!contentType) {
      throw new InvalidInputError(
        'unsupported_file',
        'Attach a JPG, PNG or PDF',
      );
    }
    return {
      filename: safeFilename(f.originalname, contentType),
      contentType,
      data: f.buffer,
    };
  });
}

/** Keeps a readable name but nothing that could break a Content-Disposition header. */
function safeFilename(name: string, contentType: string): string {
  const ext = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'application/pdf': '.pdf',
  }[contentType]!;
  const base = name
    .replace(/\.[^.]*$/, '')
    .replace(/[^\w\- ]+/g, '')
    .trim()
    .slice(0, 80);
  return `${base || 'attachment'}${ext}`;
}

/** Ops moves tickets OPEN → ACTIVE → CLOSED, and may reopen a closed one. */
export function assertTransition(from: TicketStatus, to: TicketStatus): void {
  const allowed: Record<TicketStatus, TicketStatus[]> = {
    OPEN: ['ACTIVE', 'CLOSED'],
    ACTIVE: ['CLOSED'],
    CLOSED: ['ACTIVE'],
  };
  if (from !== to && !allowed[from].includes(to)) {
    throw new ConflictError(
      'invalid_status_transition',
      `A ${from.toLowerCase()} ticket can't become ${to.toLowerCase()}`,
    );
  }
}
