/**
 * OpenAI's reasoning-era models (GPT-5 family, o-series) renamed the output
 * cap to `max_completion_tokens` and reject `max_tokens` outright with
 * `400 unsupported_parameter`. They also reject any `temperature` other than
 * the default. Sending the legacy pair fails the entire request, which
 * reaches users as an anonymous 500 on the builder chat — the same failure
 * shape `anthropicSamplingParams` exists to prevent.
 *
 * Matched on the family prefix rather than an id list for the same reason as
 * the Anthropic version regex: the catalog is refreshed live from the
 * provider, so a future `gpt-6` or `o5` must not reintroduce this the day it
 * ships.
 */
const OPENAI_REASONING_RE = /^(gpt-[5-9]|o[1-9])/i;

export function openaiUsesCompletionTokens(apiModelId: string): boolean {
  return OPENAI_REASONING_RE.test(apiModelId.trim());
}

/**
 * Builds the token-cap + sampling half of an OpenAI request body, using
 * whichever parameter names the target model actually accepts.
 */
export function openaiCompletionParams(
  apiModelId: string,
  maxOutputTokens: number,
  temperature: number | undefined,
): Record<string, unknown> {
  if (openaiUsesCompletionTokens(apiModelId)) {
    // Temperature is omitted entirely: these models accept only the default,
    // and an explicit value — even 1 — is rejected on some of them.
    return { max_completion_tokens: maxOutputTokens };
  }
  return {
    max_tokens: maxOutputTokens,
    ...(temperature === undefined ? {} : { temperature }),
  };
}
