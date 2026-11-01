import {
  ConflictError,
  InvalidInputError,
} from '../../../shared/domain/domain-error.js';
import {
  detectFileType,
  MAX_UPLOAD_BYTES,
  MAX_UPLOAD_MB,
  safeFilename,
} from '../../../shared/files/file-type.js';

export type TicketStatus = 'OPEN' | 'ACTIVE' | 'CLOSED';

export const MAX_ATTACHMENTS = 3;
/** Per file and for all files in one report together */
export const MAX_ATTACHMENT_BYTES = MAX_UPLOAD_BYTES;
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

export { detectFileType } from '../../../shared/files/file-type.js';

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
  const valid = files.map((f) => {
    if (f.size === 0 || f.size > MAX_ATTACHMENT_BYTES) {
      throw new InvalidInputError(
        'file_too_large',
        `Each file must be under ${MAX_UPLOAD_MB} MB`,
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
  if (files.reduce((sum, f) => sum + f.size, 0) > MAX_ATTACHMENT_BYTES) {
    throw new InvalidInputError(
      'files_too_large',
      `Attachments must add up to under ${MAX_UPLOAD_MB} MB`,
    );
  }
  return valid;
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
