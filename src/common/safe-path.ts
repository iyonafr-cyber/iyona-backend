import * as path from 'path';

/**
 * Reject anything that would escape the project root, hit a hidden
 * filesystem location, or land on an absolute path. AI-emitted file
 * maps go straight into S3 keys / Vercel deploy entries / Mongo
 * `componentSchema.filePath`, so a single `..` slip can put a file
 * outside the project sandbox or overwrite a sibling project's blob.
 *
 * Returns the normalized POSIX-style relative path on success, or
 * throws an `Error` on rejection — callers wrap that in their own
 * BadRequestException so the API surfaces a 400 with a useful message.
 */
export function assertSafeRelativePath(rawPath: string): string {
  if (typeof rawPath !== 'string' || rawPath.trim() === '') {
    throw new Error('File path must be a non-empty string');
  }

  // Reject NUL bytes outright — these can confuse downstream consumers
  // (S3 keys, OS calls if anyone ever shells out) and there's no
  // legitimate reason for a source file to contain one.
  if (rawPath.includes('\0')) {
    throw new Error('File path contains an illegal NUL byte');
  }

  // Force POSIX separators so `..\\` on Windows-emitted output still
  // gets normalized away.
  const unified = rawPath.replace(/\\/g, '/').trim();

  if (path.isAbsolute(unified) || /^[A-Za-z]:\//.test(unified)) {
    throw new Error(`File path must be relative: ${rawPath}`);
  }

  const normalized = path.posix.normalize(unified).replace(/^\/+/, '');

  if (
    normalized === '' ||
    normalized === '.' ||
    normalized.startsWith('../') ||
    normalized === '..' ||
    normalized.split('/').some((seg) => seg === '..')
  ) {
    throw new Error(`File path escapes the project root: ${rawPath}`);
  }

  // Hard cap to avoid pathological keys; S3 has its own 1024-char
  // limit but anything past 512 is almost certainly malformed.
  if (normalized.length > 512) {
    throw new Error(`File path exceeds 512 chars: ${normalized.length}`);
  }

  return normalized;
}
