import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import axios, { isAxiosError } from 'axios';
import { Model, Types } from 'mongoose';
import type { IEncryptionService } from '../encryption/interface/encryption.interface.service';
import { AiProviderHealthService } from './ai-provider-health.service';
import {
  AiProviderKey,
  type AiProviderKeyHealthStatus,
  type AiProviderKeyProvider,
} from './entities/ai-provider-key.entity';
import type { CreateProviderKeyDto } from './dto/create-provider-key.dto';
import type { UpdateProviderKeyDto } from './dto/update-provider-key.dto';
import { httpStatusFromError } from './provider-http-error.util';
import { openaiCompletionParams } from '../credits/openai-params';
import { isNonChatModelId } from '../models/non-chat-model';
import { isProviderCapacityFailure } from '../ai/upstream-ai-error';

/** In-memory decrypted row used only inside the API process. */
export interface ResolvedProviderKey {
  keyId: string;
  provider: AiProviderKeyProvider;
  apiKey: string;
  priority: number;
  /** OpenAI-compatible base URL when provider is openai */
  openaiBaseUrl?: string | null;
}

export interface ProviderKeyPublicDto {
  _id: string;
  provider: AiProviderKeyProvider;
  name: string;
  keyPreview: string;
  isActive: boolean;
  priority: number;
  supportedModels: string[];
  healthStatus: AiProviderKeyHealthStatus;
  lastFailureAt?: string | null;
  lastFailureReason?: string | null;
  totalRequests: number;
  requestsToday: number;
  requestsThisMinute: number;
  openaiBaseUrl?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

/** Provider error text, preferring the response body over axios' generic message. */
function describeProbeError(e: unknown): string {
  if (isAxiosError(e) && e.response?.data) {
    return JSON.stringify(e.response.data).slice(0, 400);
  }
  if (e instanceof Error) return e.message;
  return 'request failed';
}

function maskApiKey(raw: string): string {
  const t = raw.trim();
  if (t.length <= 8) return '****';
  return `${t.slice(0, 4)}…${t.slice(-4)}`;
}

/** Only reached when live discovery fails AND the key lists no models. */
const PROBE_FALLBACK: Record<AiProviderKeyProvider, string> = {
  google: 'gemini-flash-latest',
  anthropic: 'claude-haiku-4-5',
  openai: 'gpt-5-mini',
};

const PROBE_TIMEOUT_MS = 15_000;

/**
 * Output budget for the probe call.
 *
 * NOT 1. Reasoning-era models spend this budget on internal reasoning tokens
 * before emitting any visible output, so a budget of 1 fails instantly with
 * `400 "Could not finish the message because max_tokens or model output limit
 * was reached"` — which reads as a broken key in the admin dialog when the
 * key is perfectly fine. A few hundred tokens on a one-word prompt is
 * fractions of a cent and gives reasoning models room to finish.
 */
const PROBE_MAX_OUTPUT_TOKENS = 512;

/** Upper bound on probe requests per "Test key" click. */
const PROBE_MAX_CANDIDATES = 4;

@Injectable()
export class AiProviderKeysService {
  private readonly logger = new Logger(AiProviderKeysService.name);

  constructor(
    @InjectModel(AiProviderKey.name)
    private readonly keyModel: Model<AiProviderKey>,
    @Inject('IEncryptionService')
    private readonly encryption: IEncryptionService,
    @Inject(forwardRef(() => AiProviderHealthService))
    private readonly health: AiProviderHealthService,
  ) {}

  invalidateCacheSignal(): void {
    // Router subscribes via version counter pattern
    this.cacheBump++;
  }

  private cacheBump = 0;
  getCacheGeneration(): number {
    return this.cacheBump;
  }

  toPublic(row: AiProviderKey): ProviderKeyPublicDto {
    const o = row as AiProviderKey & {
      _id: Types.ObjectId;
      createdAt?: Date;
      updatedAt?: Date;
    };
    return {
      _id: String(o._id),
      provider: o.provider,
      name: o.name,
      keyPreview: o.keyPreview,
      isActive: o.isActive,
      priority: o.priority,
      supportedModels: o.supportedModels ?? [],
      healthStatus: o.healthStatus,
      lastFailureAt: o.lastFailureAt?.toISOString() ?? null,
      lastFailureReason: o.lastFailureReason ?? null,
      totalRequests: o.totalRequests ?? 0,
      requestsToday: o.requestsToday ?? 0,
      requestsThisMinute: o.requestsThisMinute ?? 0,
      openaiBaseUrl: o.openaiBaseUrl ?? null,
      createdAt: o.createdAt?.toISOString(),
      updatedAt: o.updatedAt?.toISOString(),
    };
  }

  async listAll(): Promise<ProviderKeyPublicDto[]> {
    const rows = await this.keyModel
      .find()
      .sort({ provider: 1, priority: 1 })
      .lean();
    return rows.map((r) => this.toPublic(r as AiProviderKey));
  }

  async findPublicById(id: string): Promise<ProviderKeyPublicDto | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    const row = await this.keyModel.findById(id).lean();
    if (!row) return null;
    return this.toPublic(row as AiProviderKey);
  }

  async create(
    dto: CreateProviderKeyDto,
    createdBy: Types.ObjectId | null,
  ): Promise<ProviderKeyPublicDto> {
    if (dto.provider === 'openai' && dto.openaiBaseUrl) {
      try {
        new URL(dto.openaiBaseUrl);
      } catch {
        throw new BadRequestException('openaiBaseUrl must be a valid URL');
      }
    }
    if (dto.provider !== 'openai' && dto.openaiBaseUrl) {
      throw new BadRequestException(
        'openaiBaseUrl is only valid for openai keys',
      );
    }
    const enc = this.encryption.encrypt(dto.apiKey.trim());
    const preview = maskApiKey(dto.apiKey);
    const created = await this.keyModel.create({
      provider: dto.provider,
      name: dto.name.trim(),
      apiKeyEnc: enc,
      keyPreview: preview,
      isActive: dto.isActive ?? true,
      priority: dto.priority ?? 100,
      supportedModels: dto.supportedModels ?? [],
      healthStatus: 'healthy',
      consecutiveFailures: 0,
      openaiBaseUrl:
        dto.provider === 'openai' ? dto.openaiBaseUrl?.trim() : undefined,
      totalRequests: 0,
      requestsToday: 0,
      requestsThisMinute: 0,
      createdBy: createdBy ?? undefined,
    });
    this.invalidateCacheSignal();
    return this.toPublic(created);
  }

  async update(
    id: string,
    dto: UpdateProviderKeyDto,
  ): Promise<ProviderKeyPublicDto> {
    if (!Types.ObjectId.isValid(id))
      throw new NotFoundException('Key not found');
    const existing = await this.keyModel.findById(id);
    if (!existing) throw new NotFoundException('Key not found');

    const $set: Record<string, unknown> = {};
    if (dto.name !== undefined) $set.name = dto.name.trim();
    if (dto.isActive !== undefined) $set.isActive = dto.isActive;
    if (dto.priority !== undefined) $set.priority = dto.priority;
    if (dto.supportedModels !== undefined)
      $set.supportedModels = dto.supportedModels;
    if (dto.healthStatus !== undefined) {
      $set.healthStatus = dto.healthStatus;
      if (dto.healthStatus === 'healthy') {
        $set.consecutiveFailures = 0;
        $set.lastFailureReason = null;
      }
    }
    if (dto.apiKey !== undefined) {
      $set.apiKeyEnc = this.encryption.encrypt(dto.apiKey.trim());
      $set.keyPreview = maskApiKey(dto.apiKey);
    }
    if (dto.openaiBaseUrl !== undefined) {
      if (existing.provider !== 'openai' && dto.openaiBaseUrl) {
        throw new BadRequestException(
          'openaiBaseUrl is only valid for openai keys',
        );
      }
      if (dto.openaiBaseUrl) {
        try {
          new URL(dto.openaiBaseUrl);
        } catch {
          throw new BadRequestException('openaiBaseUrl must be a valid URL');
        }
      }
      $set.openaiBaseUrl = dto.openaiBaseUrl || null;
    }

    const updated = await this.keyModel
      .findByIdAndUpdate(id, { $set }, { new: true })
      .exec();
    if (!updated) throw new NotFoundException('Key not found');
    this.invalidateCacheSignal();
    return this.toPublic(updated);
  }

  async remove(id: string): Promise<void> {
    if (!Types.ObjectId.isValid(id))
      throw new NotFoundException('Key not found');
    const res = await this.keyModel
      .deleteOne({ _id: new Types.ObjectId(id) })
      .exec();
    if (res.deletedCount === 0) throw new NotFoundException('Key not found');
    this.invalidateCacheSignal();
  }

  /**
   * Minimal authenticated request per provider, for the admin "Test key"
   * button and the health badge.
   *
   * Tries candidate models in order rather than betting on one. A single pick
   * cannot be correct: Google still *lists* `gemini-2.5-flash` while
   * answering `404 … no longer available to new users` when this key calls
   * it, so "the provider lists it" is not evidence the key can use it — only
   * the call is. A model-scoped failure moves to the next candidate; a
   * credential failure (401/403/429/billing) stops immediately, because
   * retrying other models would just spam the provider with a key we already
   * know is the problem. A 503 "high demand" is the *model* being busy, not
   * the key — walk to the next candidate (a flash spike shouldn't fail a
   * key that can still reach pro).
   */
  async testKey(id: string): Promise<{ ok: boolean; message: string }> {
    if (!Types.ObjectId.isValid(id)) {
      return { ok: false, message: 'Invalid key id' };
    }
    const row = await this.keyModel.findById(id).lean();
    if (!row) return { ok: false, message: 'Key not found' };
    let apiKey: string;
    try {
      apiKey = this.encryption.decrypt((row as AiProviderKey).apiKeyEnc);
    } catch {
      return { ok: false, message: 'Decrypt failed' };
    }

    const provider = (row as AiProviderKey).provider;
    const supported = (row as AiProviderKey).supportedModels ?? [];
    const baseUrl =
      (row as AiProviderKey).openaiBaseUrl?.trim() ||
      'https://api.openai.com/v1';

    const candidates = await this.probeModelCandidates(
      provider,
      supported,
      apiKey,
    );

    let lastError: unknown;
    let lastStatus: number | undefined;
    const skipped: string[] = [];

    for (const model of candidates) {
      try {
        await this.callProbe(provider, model, apiKey, baseUrl);
        await this.health.recordSuccess(id);
        return {
          ok: true,
          message: `Provider accepted credentials (${model})`,
        };
      } catch (e) {
        lastError = e;
        lastStatus = httpStatusFromError(e);
        const message = describeProbeError(e);
        if (this.shouldSkipProbeCandidate(lastStatus, message)) {
          skipped.push(model);
          continue;
        }
        break;
      }
    }

    await this.health.applyProbeFailure(id, lastError, lastStatus);
    const detail = describeProbeError(lastError);
    const skippedNote =
      skipped.length > 0 ? ` (tried: ${skipped.join(', ')})` : '';
    return {
      ok: false,
      message: lastStatus
        ? `HTTP ${lastStatus}: ${detail}${skippedNote}`
        : `${detail}${skippedNote}`,
    };
  }

  /**
   * Keep walking when the failure is about this *model* (gone, TTS-only,
   * or temporarily overloaded). Stop on credential/quota problems.
   * 429 stays a stop: that's the key being throttled, and more calls
   * would only make it worse.
   */
  private shouldSkipProbeCandidate(
    status: number | undefined,
    message: string,
  ): boolean {
    if (this.health.isModelScopedFailure(status, message)) return true;
    if (status === 429) return false;
    return isProviderCapacityFailure(status, message);
  }

  /** One probe request. Throws on any non-2xx so the caller can classify. */
  private async callProbe(
    provider: AiProviderKeyProvider,
    model: string,
    apiKey: string,
    openaiBaseUrl: string,
  ): Promise<void> {
    if (provider === 'openai') {
      await axios.post(
        `${openaiBaseUrl.replace(/\/$/, '')}/chat/completions`,
        {
          model,
          // Reasoning-era models reject `max_tokens`; the shared helper picks
          // whichever cap parameter this model accepts.
          ...openaiCompletionParams(model, PROBE_MAX_OUTPUT_TOKENS, undefined),
          messages: [{ role: 'user', content: 'ping' }],
        },
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: 20_000,
        },
      );
      return;
    }

    if (provider === 'anthropic') {
      // Must be a *metered* call. `GET /v1/models` answers 200 on an account
      // with no balance left, so a listing-only probe reported a healthy key
      // while every real request failed with "credit balance is too low".
      await axios.post(
        'https://api.anthropic.com/v1/messages',
        {
          model,
          max_tokens: PROBE_MAX_OUTPUT_TOKENS,
          messages: [{ role: 'user', content: 'Hi' }],
        },
        {
          headers: {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'Content-Type': 'application/json',
          },
          timeout: 20_000,
        },
      );
      return;
    }

    await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
      { contents: [{ parts: [{ text: 'Hi' }] }] },
      { headers: { 'Content-Type': 'application/json' }, timeout: 20_000 },
    );
  }

  /**
   * Ordered probe candidates, best guess first.
   *
   * Never a single pick and never a pinned id. A hardcoded `gemini-2.0-flash`
   * once failed every "Test key" with a 404 while the key was fine; then a
   * single live-discovered pick failed the same way because the provider
   * lists models the account cannot call. The caller walks this list until
   * one actually answers.
   *
   * Order: configured models the provider still lists → other listed models,
   * cheap tiers first → the rolling alias. Capped so a broken key can't fan
   * out into a dozen requests.
   */
  private async probeModelCandidates(
    provider: AiProviderKeyProvider,
    supported: string[],
    apiKey: string,
  ): Promise<string[]> {
    const live = await this.listProviderModels(provider, apiKey);
    const configured = supported
      .map((m) => m.trim())
      .filter(Boolean)
      .filter((m) => !isNonChatModelId(m));

    // Anchor on a separator: a bare /mini/ matches every *ge-mini* model,
    // which silently picked pro tiers for the probe.
    const isCheap = (m: string) => /(^|[-_.])(flash|mini|haiku)/i.test(m);
    const cheap = live.filter(isCheap);
    const rest = live.filter((m) => !isCheap(m));

    // Don't fill the 4-slot budget with only flash variants — a flash
    // 503 then used to fail the whole test while pro was idle.
    const ordered = [
      ...configured.filter((m) => live.includes(m)),
      ...cheap.slice(0, 2),
      ...rest.slice(0, 2),
      ...(live.length === 0 ? configured : []),
      PROBE_FALLBACK[provider],
    ];

    return [...new Set(ordered)].filter(Boolean).slice(0, PROBE_MAX_CANDIDATES);
  }

  /** Model ids a provider currently serves; [] if listing isn't available. */
  private async listProviderModels(
    provider: AiProviderKeyProvider,
    apiKey: string,
  ): Promise<string[]> {
    try {
      if (provider === 'google') {
        const res = await axios.get<{
          models?: { name?: string; supportedGenerationMethods?: string[] }[];
        }>(
          `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`,
          { timeout: PROBE_TIMEOUT_MS },
        );
        return (res.data?.models ?? [])
          .filter((m) =>
            (m.supportedGenerationMethods ?? []).includes('generateContent'),
          )
          .map((m) => (m.name ?? '').replace(/^models\//, ''))
          .filter((id) => id && !isNonChatModelId(id));
      }
      if (provider === 'anthropic') {
        const res = await axios.get<{ data?: { id?: string }[] }>(
          'https://api.anthropic.com/v1/models',
          {
            headers: {
              'x-api-key': apiKey,
              'anthropic-version': '2023-06-01',
            },
            timeout: PROBE_TIMEOUT_MS,
          },
        );
        return (res.data?.data ?? [])
          .map((m) => m.id ?? '')
          .filter((id) => id && !isNonChatModelId(id));
      }
      return [];
    } catch {
      // Best effort. If the credential is the problem, the metered probe
      // below reports it with a real status.
      return [];
    }
  }

  /**
   * Load healthy active keys, decrypt, and build routing rows. Called on a TTL
   * by AiProviderRouterService — not on every token.
   */
  async loadRoutingSnapshot(): Promise<{
    keys: ResolvedProviderKey[];
    supportedByKeyId: Map<string, string[]>;
  }> {
    const rows = await this.keyModel
      .find({
        isActive: true,
        healthStatus: { $in: ['healthy'] },
      })
      .sort({ provider: 1, priority: 1, _id: 1 })
      .lean();

    const supportedByKeyId = new Map<string, string[]>();
    const out: ResolvedProviderKey[] = [];
    for (const row of rows) {
      const id = String((row as { _id: Types.ObjectId })._id);
      supportedByKeyId.set(id, (row as AiProviderKey).supportedModels ?? []);
      try {
        const apiKey = this.encryption.decrypt(
          (row as AiProviderKey).apiKeyEnc,
        );
        out.push({
          keyId: id,
          provider: (row as AiProviderKey).provider,
          apiKey,
          priority: (row as AiProviderKey).priority ?? 100,
          openaiBaseUrl: (row as AiProviderKey).openaiBaseUrl ?? null,
        });
      } catch (e) {
        this.logger.error(
          `Failed to decrypt provider key ${id}: ${
            e instanceof Error ? e.message : e
          }`,
        );
      }
    }
    return { keys: out, supportedByKeyId };
  }

  async recordUsageSuccess(keyId: string): Promise<void> {
    if (!Types.ObjectId.isValid(keyId)) return;
    const doc = await this.keyModel.findById(keyId);
    if (!doc) return;

    const now = new Date();
    const day = now.toISOString().slice(0, 10);
    const minuteBucket = `${day}T${String(now.getUTCHours()).padStart(2, '0')}:${String(
      now.getUTCMinutes(),
    ).padStart(2, '0')}`;

    let requestsToday = doc.requestsToday ?? 0;
    if (doc.usageDay !== day) requestsToday = 1;
    else requestsToday += 1;

    let requestsThisMinute = doc.requestsThisMinute ?? 0;
    if (doc.usageMinuteBucket !== minuteBucket) requestsThisMinute = 1;
    else requestsThisMinute += 1;

    await this.keyModel.updateOne(
      { _id: doc._id },
      {
        $inc: { totalRequests: 1 },
        $set: {
          usageDay: day,
          requestsToday,
          usageMinuteBucket: minuteBucket,
          requestsThisMinute,
        },
      },
    );
  }
}
