/**
 * Model ids that look like coding families but are not text/chat
 * generation — audio, speech, transcription, realtime, image,
 * embeddings, moderation, and legacy `-instruct` completions.
 *
 * Shared by catalog refresh and the admin "Test key" probe. Letting
 * these through is not harmless: Google lists TTS models under
 * `generateContent`, the probe sorts `flash` first, and
 * `gemini-2.5-flash-preview-tts` then rejects TEXT with HTTP 400
 * INVALID_ARGUMENT ("response modalities … AUDIO"). That used to fail
 * the whole key test.
 */
export const NON_CHAT_MODEL_PATTERN =
  /(realtime|audio|tts|transcribe|whisper|embedding|moderation|image|dall-e|search-preview|-instruct)/i;

export function isNonChatModelId(modelId: string): boolean {
  return NON_CHAT_MODEL_PATTERN.test(modelId);
}
