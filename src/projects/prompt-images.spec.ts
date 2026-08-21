import {
  PROMPT_IMAGE_MAX_BYTES,
  parsePromptImageDataUrl,
} from './prompt-images';

/**
 * These data URLs come straight from the browser's FileReader, so the parser is
 * the only thing standing between a user's paste and an S3 upload.
 */
describe('parsePromptImageDataUrl', () => {
  const pngBase64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

  it('decodes a PNG data URL', () => {
    const parsed = parsePromptImageDataUrl(
      `data:image/png;base64,${pngBase64}`,
    );
    expect(parsed?.mimeType).toBe('image/png');
    expect(parsed?.extension).toBe('png');
    expect(parsed?.buffer.byteLength).toBeGreaterThan(0);
  });

  it('normalises image/jpg to image/jpeg', () => {
    // Not a real MIME type, but it reaches us often enough to be worth
    // accepting rather than rejecting a valid JPEG over a naming quirk.
    const parsed = parsePromptImageDataUrl(
      `data:image/jpg;base64,${pngBase64}`,
    );
    expect(parsed?.mimeType).toBe('image/jpeg');
    expect(parsed?.extension).toBe('jpg');
  });

  it('rejects a type Cursor does not accept', () => {
    expect(
      parsePromptImageDataUrl(`data:image/svg+xml;base64,${pngBase64}`),
    ).toBeNull();
    expect(
      parsePromptImageDataUrl(`data:application/pdf;base64,${pngBase64}`),
    ).toBeNull();
  });

  it('rejects anything that is not a base64 data URL', () => {
    expect(parsePromptImageDataUrl('https://example.com/cat.png')).toBeNull();
    expect(parsePromptImageDataUrl('data:image/png,not-base64')).toBeNull();
    expect(parsePromptImageDataUrl('')).toBeNull();
  });

  it('reports the decoded byte length, which is what the size cap checks', () => {
    const parsed = parsePromptImageDataUrl(
      `data:image/png;base64,${pngBase64}`,
    );
    // Decoded bytes are ~3/4 of the base64 text; capping the string length
    // instead would reject images that are actually within the limit.
    expect(parsed!.buffer.byteLength).toBeLessThan(pngBase64.length);
    expect(parsed!.buffer.byteLength).toBeLessThan(PROMPT_IMAGE_MAX_BYTES);
  });
});
