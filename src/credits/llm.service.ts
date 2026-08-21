import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { httpStatusFromError } from '../ai-provider-keys/provider-http-error.util';
import { openaiCompletionParams } from './openai-params';
import {
  GoogleGenerativeAI,
  type Content,
  type Part,
} from '@google/generative-ai';
import { AiProviderHealthService } from '../ai-provider-keys/ai-provider-health.service';
import { AiProviderKeysService } from '../ai-provider-keys/ai-provider-keys.service';
import { AiProviderRouterService } from '../ai-provider-keys/ai-provider-router.service';
import {
  ModelRouterService,
  PickModelOverride,
  RouteDecision,
  RouterTask,
} from './model-router.service';
import { ModelCatalogService } from '../models/models.service';
import { MODEL_PRICES, PricingService, TokenUsage } from './pricing.service';

/**
 * Neutral chat message shape accepted by `LlmService.chat`. Mirrors
 * OpenAI's role/content style because every caller already speaks that
 * dialect; Anthropic's `system` prompt is derived from a leading `system`
 * message when present.
 */
export interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  /**
   * Either a plain string (the common case) or a structured list for
   * multimodal inputs (image + text). Only OpenAI-style image_url is
   * accepted here; the wrapper converts to Anthropic's shape when
   * routing to Claude.
   */
  content:
    | string
    | Array<
        | { type: 'text'; text: string }
        | { type: 'image_url'; image_url: { url: string } }
      >;
}

export interface LlmRequest {
  task: RouterTask;
  messages: LlmMessage[];
  /**
   * Soft cap on output tokens. Always clamped to the route's own
   * `maxOutputTokens` hard ceiling so callers can't accidentally burn
   * through a user's credits on one request.
   */
  maxOutputTokens?: number;
  temperature?: number;
  /** Forces the response to be JSON. Maps to provider-specific flags. */
  jsonMode?: boolean;
  /** Pre-computed input token estimate used for routing/reservation. */
  estimatedInputTokens?: number;
  /**
   * Non-interruption escape hatch: when set, `LlmService` skips
   * `pickModel` entirely and uses this exact model string against
   * whichever provider owns it. Callers that care about not being
   * affected by mid-flight catalog mutations (ai.service, patch.service)
   * snapshot the route once at request entry and pass it back in here.
   */
  overrideModel?: string;
  /**
   * Optional abort signal. When the signal fires the provider stream is
   * cancelled immediately — the generator throws `AbortError` which the
   * caller catches to stop consuming tokens and to trigger a credit
   * refund for the abandoned request.
   */
  signal?: AbortSignal;
}

export interface LlmResponse {
  content: string;
  usage: TokenUsage;
  route: RouteDecision;
  /**
   * True when the provider stopped because it hit the output-token ceiling
   * (`finish_reason: 'length'` / `stop_reason: 'max_tokens'` / Google
   * `MAX_TOKENS`). The `content` is then a partial, likely-unparseable
   * response and MUST NOT be trusted as complete (e.g. used as a build spec).
   */
  truncated?: boolean;
  /** Raw provider stop/finish reason, for logging and error classification. */
  finishReason?: string;
}

/**
 * Catalog id → real Anthropic API id, for the two rows whose catalog id
 * isn't itself a valid API id. Every other catalog id (`claude-opus-4-7`,
 * `claude-sonnet-4-6`, …) is passed through untouched because it already
 * matches what `GET /v1/models` returns.
 *
 * These previously pointed at `claude-{sonnet,opus}-4-20250514` — Claude 4,
 * not 4.5 — which Anthropic has since retired. Any call routed to a 4.5 row
 * got a 404 `not_found_error` from the provider, surfacing as a 500. Verified
 * against `GET /v1/models`; do not "simplify" these back to undated ids.
 */
export const ANTHROPIC_MODEL_ALIASES: Record<string, string> = {
  'claude-sonnet-4-5': 'claude-sonnet-4-5-20250929',
  'claude-opus-4-5': 'claude-opus-4-5-20251101',
};

/**
 * Catalog id → live OpenAI API id. `gpt-5-codex` was shut down on
 * 2026-07-23; calling it returns `404 The model has been deprecated`,
 * which `/ai/validate` used to render as an anonymous 500. Map onto
 * `gpt-4o` (already in the catalog / pricing table) so existing task
 * routes and project defaults keep working after the catalog row is
 * disabled. Official successor is `gpt-5.6-sol`; we stay on a row we
 * already bill and probe rather than introducing an uncatalogued id.
 */
export const OPENAI_MODEL_ALIASES: Record<string, string> = {
  'gpt-5-codex': 'gpt-4o',
};

/**
 * Upper bound for a single non-streaming Anthropic call. Any explicit value
 * disables the SDK's "this might take >10 minutes, so stream it" guard; 10
 * minutes matches the threshold the guard itself uses.
 */
const ANTHROPIC_NON_STREAMING_TIMEOUT_MS = 600_000;

/** Matches the family/major/minor prefix of an Anthropic id, dated or not. */
const ANTHROPIC_VERSION_RE = /^claude-(opus|sonnet|haiku)-(\d+)-(\d+)/;

/**
 * Anthropic dropped the sampling parameters (`temperature`, `top_p`, `top_k`)
 * on Claude Opus 4.7 and every Opus release after it. Sending one at all —
 * even `temperature: 0` — fails the whole request with
 * `400 invalid_request_error: "temperature is deprecated for this model."`,
 * which surfaced to users as "Internal server error" on the builder chat.
 *
 * The restriction is per-model, not per-key, so it can't be expressed as an
 * alias entry and the catalog carries no capability column. Matching on the
 * version prefix (rather than listing exact ids) is deliberate: catalog rows
 * are refreshed straight from `GET /v1/models`, so a future `claude-opus-4-8`
 * would otherwise reintroduce the same 500 the day it lands. Only Opus is
 * affected — Sonnet and Haiku still accept sampling params.
 */
export function anthropicAcceptsSamplingParams(apiModelId: string): boolean {
  const match = ANTHROPIC_VERSION_RE.exec(apiModelId);
  if (!match) return true;
  const [, family, major, minor] = match;
  if (family !== 'opus') return true;
  return Number(major) <= 4 && !(Number(major) === 4 && Number(minor) >= 7);
}

/**
 * Builds the sampling half of an Anthropic request body: the parameter is
 * omitted entirely both when the caller didn't ask for one and when the
 * target model no longer accepts it.
 */
export function anthropicSamplingParams(
  apiModelId: string,
  temperature: number | undefined,
): { temperature?: number } {
  if (temperature === undefined) return {};
  if (!anthropicAcceptsSamplingParams(apiModelId)) return {};
  return { temperature };
}

/**
 * Catalog id → real Gemini API id. Only the synthetic seed row needs one;
 * ids discovered via `POST /admin/models/refresh` are already real and must
 * pass through untouched. See {@link LlmService.toGoogleModelId}.
 */
export const GOOGLE_MODEL_ALIASES: Record<string, string> = {
  'gemini-3-1-high': 'gemini-3.1-high',
};

function toThrownError(last: unknown, fallback: string): Error {
  if (last instanceof Error) return last;
  if (typeof last === 'string') return new Error(last);
  return new Error(fallback);
}

/**
 * Unified wrapper over OpenAI Chat Completions and Anthropic Messages.
 *
 * Callers declare a `task` (see `RouterTask`) and the router picks the
 * provider + model. The wrapper then:
 *
 *   1. Normalizes prompt shape for the chosen provider.
 *   2. Asks the provider for token usage (stream_options on OpenAI,
 *      `message_start` / `message_delta` events on Anthropic).
 *   3. Returns a single `LlmResponse` (or an `AsyncGenerator` of
 *      `LlmStreamEvent`s) regardless of which provider answered.
 *
 * This is the only place in the codebase that instantiates provider SDKs —
 * AiService and PatchService call LlmService.
 */
@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);

  constructor(
    private readonly router: ModelRouterService,
    private readonly pricing: PricingService,
    private readonly catalog: ModelCatalogService,
    private readonly providerRouter: AiProviderRouterService,
    private readonly providerHealth: AiProviderHealthService,
    private readonly providerKeys: AiProviderKeysService,
  ) {
    this.logger.log('LlmService initialized (DB-backed provider keys)');
  }

  pickRoute(
    task: RouterTask,
    hints: { estimatedInputTokens?: number } = {},
    override: PickModelOverride = {},
  ): RouteDecision {
    return this.router.pickModel(task, hints, override);
  }

  /**
   * Resolve the route for a single `chat`/`chatStream` call. When a
   * caller passed `overrideModel`, we skip the router entirely and build
   * a route from the provider recorded in the catalog / static pricing
   * map. This is what keeps in-flight requests safe from mid-flight
   * admin mutations — the caller has already snapshotted the model.
   */
  private resolveRoute(req: LlmRequest): RouteDecision {
    if (req.overrideModel) {
      const snapshot = this.catalog.get(req.overrideModel);
      if (snapshot) {
        return {
          provider: snapshot.provider,
          model: snapshot.modelId,
          maxOutputTokens: snapshot.maxOutputTokens,
          fellBack: false,
        };
      }
      const staticPrice = MODEL_PRICES[req.overrideModel];
      if (staticPrice) {
        return {
          provider: staticPrice.provider,
          model: req.overrideModel,
          maxOutputTokens: staticPrice.maxOutputTokens,
          fellBack: false,
        };
      }
      throw new Error(`Unknown overrideModel: ${req.overrideModel}`);
    }
    return this.router.pickModel(req.task, {
      estimatedInputTokens: req.estimatedInputTokens,
    });
  }

  async chat(req: LlmRequest): Promise<LlmResponse> {
    await this.providerRouter.ensureCache();
    const route = this.resolveRoute(req);
    const maxOutputTokens = this.clampOutputTokens(route, req.maxOutputTokens);

    if (route.provider === 'openai') {
      return this.chatOpenAI(req, route, maxOutputTokens);
    }
    if (route.provider === 'anthropic') {
      return this.chatAnthropic(req, route, maxOutputTokens);
    }
    return this.chatGoogle(req, route, maxOutputTokens);
  }

  private async chatOpenAI(
    req: LlmRequest,
    route: RouteDecision,
    maxOutputTokens: number,
  ): Promise<LlmResponse> {
    const candidates = await this.providerRouter.getCandidatesForModel(
      'openai',
      route.model,
    );
    if (candidates.length === 0) {
      throw new Error('OpenAI provider not configured');
    }
    let lastErr: unknown = new Error('OpenAI request failed');
    for (const key of candidates) {
      const client = new OpenAI({
        apiKey: key.apiKey,
        baseURL: key.openaiBaseUrl?.trim() || 'https://api.openai.com/v1',
      });
      try {
        const apiModel = this.toOpenAIModelId(route.model);
        const response = await client.chat.completions.create({
          model: apiModel,
          messages: this.toOpenAIMessages(req.messages),
          ...openaiCompletionParams(
            apiModel,
            maxOutputTokens,
            req.temperature,
          ),
          ...(req.jsonMode ? { response_format: { type: 'json_object' } } : {}),
        });
        const content = response.choices[0]?.message?.content ?? '';
        const finishReason = response.choices[0]?.finish_reason ?? undefined;
        const usage: TokenUsage = {
          inputTokens: response.usage?.prompt_tokens ?? 0,
          outputTokens: response.usage?.completion_tokens ?? 0,
          model: route.model,
          provider: 'openai',
        };
        void this.providerKeys.recordUsageSuccess(key.keyId);
        await this.providerHealth.recordSuccess(key.keyId);
        return {
          content,
          usage,
          route,
          finishReason,
          truncated: finishReason === 'length',
        };
      } catch (err) {
        lastErr = err;
        await this.providerHealth.recordFailure(
          key.keyId,
          err,
          httpStatusFromError(err),
        );
      }
    }
    throw toThrownError(lastErr, 'OpenAI request failed');
  }

  private async chatAnthropic(
    req: LlmRequest,
    route: RouteDecision,
    maxOutputTokens: number,
  ): Promise<LlmResponse> {
    const candidates = await this.providerRouter.getCandidatesForModel(
      'anthropic',
      route.model,
    );
    if (candidates.length === 0) {
      throw new Error('Anthropic provider not configured');
    }
    const { system, messages } = this.toAnthropicMessages(req.messages);
    const model = this.toAnthropicModelId(route.model);
    let lastErr: unknown = new Error('Anthropic request failed');
    for (const key of candidates) {
      // Explicit timeout is required, not cosmetic: without one the SDK
      // refuses any non-streaming request whose `max_tokens` implies a
      // >10-minute completion, throwing "Streaming is required for
      // operations that may take longer than 10 minutes" *client-side*
      // before issuing a request. Because that throw carries no HTTP status,
      // health classification treated it as a key fault and demoted a
      // perfectly good key out of routing. Setting a timeout opts out of the
      // heuristic and lets the call proceed.
      const anthropic = new Anthropic({
        apiKey: key.apiKey,
        timeout: ANTHROPIC_NON_STREAMING_TIMEOUT_MS,
      });
      try {
        const response = await anthropic.messages.create({
          model,
          max_tokens: maxOutputTokens,
          ...anthropicSamplingParams(model, req.temperature),
          system,
          messages,
        });
        const content = response.content
          .filter((c): c is Anthropic.TextBlock => c.type === 'text')
          .map((c) => c.text)
          .join('\n');
        const finishReason = response.stop_reason ?? undefined;
        const usage: TokenUsage = {
          inputTokens: response.usage.input_tokens ?? 0,
          outputTokens: response.usage.output_tokens ?? 0,
          model: route.model,
          provider: 'anthropic',
        };
        void this.providerKeys.recordUsageSuccess(key.keyId);
        await this.providerHealth.recordSuccess(key.keyId);
        return {
          content,
          usage,
          route,
          finishReason: finishReason ?? undefined,
          truncated: finishReason === 'max_tokens',
        };
      } catch (err) {
        lastErr = err;
        await this.providerHealth.recordFailure(
          key.keyId,
          err,
          httpStatusFromError(err),
        );
      }
    }
    throw toThrownError(lastErr, 'Anthropic request failed');
  }

  private async chatGoogle(
    req: LlmRequest,
    route: RouteDecision,
    maxOutputTokens: number,
  ): Promise<LlmResponse> {
    const candidates = await this.providerRouter.getCandidatesForModel(
      'google',
      route.model,
    );
    if (candidates.length === 0) {
      throw new Error('Google provider not configured');
    }
    const { systemInstruction, contents } = this.toGoogleContents(req.messages);
    let lastErr: unknown = new Error('Google request failed');
    for (const key of candidates) {
      const google = new GoogleGenerativeAI(key.apiKey);
      try {
        const model = google.getGenerativeModel({
          model: this.toGoogleModelId(route.model),
          systemInstruction,
          generationConfig: {
            maxOutputTokens,
            temperature: req.temperature,
            ...(req.jsonMode ? { responseMimeType: 'application/json' } : {}),
          },
        });
        const result = await model.generateContent({ contents });
        const content = result.response?.text() ?? '';
        const finishReason = result.response?.candidates?.[0]?.finishReason as
          | string
          | undefined;
        const meta = result.response?.usageMetadata;
        const usage: TokenUsage = {
          inputTokens: meta?.promptTokenCount ?? 0,
          outputTokens: meta?.candidatesTokenCount ?? 0,
          model: route.model,
          provider: 'google',
        };
        void this.providerKeys.recordUsageSuccess(key.keyId);
        await this.providerHealth.recordSuccess(key.keyId);
        return {
          content,
          usage,
          route,
          finishReason,
          truncated: finishReason === 'MAX_TOKENS',
        };
      } catch (err) {
        lastErr = err;
        await this.providerHealth.recordFailure(
          key.keyId,
          err,
          httpStatusFromError(err),
        );
      }
    }
    throw toThrownError(lastErr, 'Google request failed');
  }

  private toGoogleModelId(internalId: string): string {
    return GOOGLE_MODEL_ALIASES[internalId] ?? internalId;
  }

  private toAnthropicModelId(internalId: string): string {
    return ANTHROPIC_MODEL_ALIASES[internalId] ?? internalId;
  }

  private toOpenAIModelId(internalId: string): string {
    return OPENAI_MODEL_ALIASES[internalId] ?? internalId;
  }

  private toGoogleContents(messages: LlmMessage[]): {
    systemInstruction?: { role: 'system'; parts: Part[] };
    contents: Content[];
  } {
    let systemText: string | undefined;
    const contents: Content[] = [];

    for (const m of messages) {
      if (m.role === 'system') {
        const text =
          typeof m.content === 'string'
            ? m.content
            : m.content
                .filter(
                  (p): p is { type: 'text'; text: string } => p.type === 'text',
                )
                .map((p) => p.text)
                .join('\n');
        systemText = systemText ? `${systemText}\n\n${text}` : text;
        continue;
      }

      const role: 'user' | 'model' = m.role === 'assistant' ? 'model' : 'user';
      const parts: Part[] = [];
      if (typeof m.content === 'string') {
        parts.push({ text: m.content });
      } else {
        for (const part of m.content) {
          if (part.type === 'text') {
            parts.push({ text: part.text });
          } else {
            const inline = this.dataUrlToGoogleInline(part.image_url.url);
            if (inline) parts.push(inline);
          }
        }
      }
      contents.push({ role, parts });
    }

    return {
      systemInstruction: systemText
        ? { role: 'system', parts: [{ text: systemText }] }
        : undefined,
      contents,
    };
  }

  private dataUrlToGoogleInline(url: string): Part | null {
    const match = url.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
    if (!match) return null;
    return {
      inlineData: {
        mimeType: match[1],
        data: match[2],
      },
    };
  }

  // ──────────────────────────────────────────────────────────────
  // Shape translators
  // ──────────────────────────────────────────────────────────────

  private clampOutputTokens(route: RouteDecision, requested?: number): number {
    const hard = this.pricing.getPrice(route.model).maxOutputTokens;
    if (!requested) return hard;
    return Math.min(Math.max(1, requested), hard);
  }

  private toOpenAIMessages(
    messages: LlmMessage[],
  ): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
    return messages.map((m) => {
      if (typeof m.content === 'string') {
        return {
          role: m.role,
          content: m.content,
        } as OpenAI.Chat.Completions.ChatCompletionMessageParam;
      }
      return {
        role: m.role,
        content: m.content.map((part) =>
          part.type === 'text'
            ? { type: 'text' as const, text: part.text }
            : {
                type: 'image_url' as const,
                image_url: part.image_url,
              },
        ),
      } as OpenAI.Chat.Completions.ChatCompletionMessageParam;
    });
  }

  private toAnthropicMessages(messages: LlmMessage[]): {
    system?: string;
    messages: Anthropic.MessageParam[];
  } {
    let system: string | undefined;
    const rest: Anthropic.MessageParam[] = [];

    for (const m of messages) {
      if (m.role === 'system') {
        const text =
          typeof m.content === 'string'
            ? m.content
            : m.content
                .filter(
                  (c): c is { type: 'text'; text: string } => c.type === 'text',
                )
                .map((c) => c.text)
                .join('\n');
        system = system ? `${system}\n\n${text}` : text;
        continue;
      }

      const role: 'user' | 'assistant' =
        m.role === 'assistant' ? 'assistant' : 'user';
      if (typeof m.content === 'string') {
        rest.push({ role, content: m.content });
      } else {
        rest.push({
          role,
          content: m.content.map((part) => {
            if (part.type === 'text') {
              return { type: 'text', text: part.text };
            }
            return this.dataUrlToAnthropicImage(part.image_url.url);
          }),
        });
      }
    }

    return { system, messages: rest };
  }

  private dataUrlToAnthropicImage(url: string): Anthropic.ImageBlockParam {
    const match = url.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
    if (match) {
      return {
        type: 'image',
        source: {
          type: 'base64',
          media_type: match[1] as
            | 'image/png'
            | 'image/jpeg'
            | 'image/gif'
            | 'image/webp',
          data: match[2],
        },
      };
    }
    return {
      type: 'image',
      source: { type: 'url', url },
    };
  }
}
