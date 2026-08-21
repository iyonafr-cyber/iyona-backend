import { isNonChatModelId } from './non-chat-model';

describe('isNonChatModelId', () => {
  it('flags the live Gemini TTS model the key probe was hitting', () => {
    expect(isNonChatModelId('gemini-2.5-flash-preview-tts')).toBe(true);
  });

  it('keeps text Gemini flash/pro ids', () => {
    expect(isNonChatModelId('gemini-2.5-flash')).toBe(false);
    expect(isNonChatModelId('gemini-3.6-flash')).toBe(false);
    expect(isNonChatModelId('gemini-flash-latest')).toBe(false);
  });

  it('flags other specialist families the catalog already excluded', () => {
    expect(isNonChatModelId('gpt-4o-audio-preview')).toBe(true);
    expect(isNonChatModelId('text-embedding-3-large')).toBe(true);
    expect(isNonChatModelId('dall-e-3')).toBe(true);
  });
});
