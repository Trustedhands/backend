import {
  assertTransition,
  deriveSubject,
  detectFileType,
  validateAttachments,
} from './ticket.js';

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(10),
]);
const pdf = Buffer.from('%PDF-1.7 rest');
const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]);

describe('ticket rules', () => {
  it('derives a subject from the first line', () => {
    expect(deriveSubject('  Late arrival\nThe worker came at 10:15')).toBe(
      'Late arrival',
    );
    const long = deriveSubject(
      'The worker arrived at 10:15 instead of 9:00, so the second bathroom was not finished.',
    );
    expect(long.length).toBeLessThanOrEqual(60);
    expect(long.endsWith('…')).toBe(true);
  });

  it('detects file types by content, not name', () => {
    expect(detectFileType(png)).toBe('image/png');
    expect(detectFileType(pdf)).toBe('application/pdf');
    expect(detectFileType(jpg)).toBe('image/jpeg');
    expect(detectFileType(Buffer.from('MZ executable'))).toBeNull();
  });

  it('sanitises names and fixes extensions to the real type', () => {
    const [a] = validateAttachments([
      { originalname: '../../evil"name.exe', buffer: png, size: png.length },
    ]);
    expect(a).toMatchObject({
      filename: 'evilname.png',
      contentType: 'image/png',
    });
  });

  it('rejects unsupported, oversized and too many files', () => {
    expect(() =>
      validateAttachments([
        { originalname: 'a.pdf', buffer: Buffer.from('nope'), size: 4 },
      ]),
    ).toThrow(expect.objectContaining({ code: 'unsupported_file' }));
    expect(() =>
      validateAttachments([
        { originalname: 'a.png', buffer: png, size: 6 * 1024 * 1024 },
      ]),
    ).toThrow(expect.objectContaining({ code: 'file_too_large' }));
    const f = { originalname: 'a.png', buffer: png, size: png.length };
    expect(() => validateAttachments([f, f, f, f])).toThrow(
      expect.objectContaining({ code: 'too_many_files' }),
    );
  });

  it('allows reopening but not un-starting', () => {
    expect(() => assertTransition('CLOSED', 'ACTIVE')).not.toThrow();
    expect(() => assertTransition('ACTIVE', 'OPEN')).toThrow(
      expect.objectContaining({ code: 'invalid_status_transition' }),
    );
  });
});
