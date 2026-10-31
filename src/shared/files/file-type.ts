import { StreamableFile } from '@nestjs/common';

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

const SIGNATURES: ReadonlyArray<{
  type: string;
  ext: string;
  matches: (b: Buffer) => boolean;
}> = [
  {
    type: 'image/jpeg',
    ext: '.jpg',
    matches: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    type: 'image/png',
    ext: '.png',
    matches: (b) =>
      b
        .subarray(0, 8)
        .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  {
    type: 'application/pdf',
    ext: '.pdf',
    matches: (b) => b.subarray(0, 5).toString('latin1') === '%PDF-',
  },
];

/** Identifies an upload by its bytes, ignoring the client's claimed type and name. */
export function detectFileType(bytes: Buffer): string | null {
  return SIGNATURES.find((s) => s.matches(bytes))?.type ?? null;
}

/** Keeps a readable name but nothing that could break a Content-Disposition header. */
export function safeFilename(name: string, contentType: string): string {
  const ext = SIGNATURES.find((s) => s.type === contentType)?.ext ?? '';
  const base = name
    .replace(/\.[^.]*$/, '')
    .replace(/[^\w\- ]+/g, '')
    .trim()
    .slice(0, 80);
  return `${base || 'file'}${ext}`;
}

/** Headers for serving uploaded files inertly; pair with serveUpload(). */
export const UPLOAD_RESPONSE_HEADERS: ReadonlyArray<[string, string]> = [
  ['X-Content-Type-Options', 'nosniff'],
  ['Content-Security-Policy', "sandbox; default-src 'none'; img-src 'self'"],
  ['Cache-Control', 'private, max-age=300'],
];

export function serveUpload(file: {
  filename: string;
  contentType: string;
  data: Buffer;
}): StreamableFile {
  return new StreamableFile(file.data, {
    type: file.contentType,
    length: file.data.length,
    disposition: `inline; filename="${file.filename}"`,
  });
}
