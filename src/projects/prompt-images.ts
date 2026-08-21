/**
 * Images attached to a workspace prompt, on their way to the Cursor agent.
 *
 * The browser hands us `data:` URLs (it already made them for the chat
 * thumbnail), we upload the bytes to S3, and Cursor is given a URL to fetch —
 * not the bytes. That matters because the run is asynchronous: base64 in the
 * request body would also have to be persisted on the job row and dragged
 * through Mongo until the agent picks the job up.
 */

/** Cursor's own cap: at most 5 images per prompt. */
export const PROMPT_IMAGE_MAX_COUNT = 5;

/**
 * Per-image cap. Cursor allows 15 MB, but the whole request body is limited to
 * 10 MB (`MAX_REQUEST_BODY_SIZE` in main.ts) and base64 inflates bytes by ~33%,
 * so their limit is unreachable here. 4 MB leaves room for five of them plus
 * the prompt text.
 */
export const PROMPT_IMAGE_MAX_BYTES = 4 * 1024 * 1024;

/** The MIME types Cursor accepts for prompt images. */
const EXTENSION_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

export const PROMPT_IMAGE_MIME_TYPES = Object.keys(EXTENSION_BY_MIME);

export interface ParsedPromptImage {
  buffer: Buffer;
  mimeType: string;
  /** File extension for the S3 key, derived from the MIME type. */
  extension: string;
}

const DATA_URL_PATTERN = /^data:([^;,]+);base64,(.+)$/s;

/**
 * Decode one `data:image/...;base64,...` URL. Returns null for anything that
 * isn't a base64 image data URL in a type Cursor accepts — callers turn that
 * into a 400 rather than uploading junk.
 */
export function parsePromptImageDataUrl(
  dataUrl: string,
): ParsedPromptImage | null {
  const match = DATA_URL_PATTERN.exec(dataUrl.trim());
  if (!match) return null;

  // `image/jpg` is not a real MIME type but is easy to hand-write; normalise
  // it rather than rejecting a perfectly good JPEG.
  const mimeType =
    match[1].toLowerCase() === 'image/jpg'
      ? 'image/jpeg'
      : match[1].toLowerCase();
  const extension = EXTENSION_BY_MIME[mimeType];
  if (!extension) return null;

  const buffer = Buffer.from(match[2], 'base64');
  if (buffer.byteLength === 0) return null;

  return { buffer, mimeType, extension };
}
