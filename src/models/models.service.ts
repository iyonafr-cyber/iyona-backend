import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AiModel } from './entities/ai-model.entity';
import {
  MODEL_CATALOG_SEED,
  RETIRED_MODEL_IDS,
  SeedModel,
} from './model-catalog.seed';

export interface ModelSnapshot {
  modelId: string;
  provider: AiModel['provider'];
  displayName: string;
  tier: AiModel['tier'];
  category: AiModel['category'];
  enabled: boolean;
  isDefault: boolean;
  order: number;
  inputPerMillion: number;
  outputPerMillion: number;
  maxOutputTokens: number;
  contextTokens: number;
  codingOptimized: boolean;
  deprecatedAt?: Date;
  lastSeenAt?: Date;
  /** Provider publish date; undefined for providers that don't report one. */
  releasedAt?: Date;
}

/**
 * Read-through cache of the `AiModel` catalog. The cache is reloaded
 * fully on every write (`reload()`) — writes are rare (admin panel
 * only) and the table is tiny (<20 rows), so a full refresh beats
 * tracking individual keys.
 *
 * Crucially, every *lookup* returns the cached snapshot object, so
 * once a request has grabbed a snapshot it is immune to subsequent
 * admin mutations — the router captures the full `ModelSnapshot` at
 * the request boundary and uses it through the lifetime of the call.
 */
@Injectable()
export class ModelCatalogService implements OnModuleInit {
  private readonly logger = new Logger(ModelCatalogService.name);
  private cache: Map<string, ModelSnapshot> = new Map();
  private defaultModelId: string | null = null;

  constructor(
    @InjectModel(AiModel.name)
    private readonly modelModel: Model<AiModel>,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.seed();
    await this.reload();
  }

  /**
   * Idempotent upsert of the seed manifest. Only pricing / capability
   * fields are `$set` — admin-managed flags (`enabled`, `displayName`,
   * `order`, `isDefault`) are only applied on insert, so admin edits
   * survive boot seeding.
   */
  async seed(): Promise<void> {
    for (const row of MODEL_CATALOG_SEED) {
      await this.modelModel.findOneAndUpdate(
        { modelId: row.modelId },
        {
          $set: {
            provider: row.provider,
            inputPerMillion: row.inputPerMillion,
            outputPerMillion: row.outputPerMillion,
            maxOutputTokens: row.maxOutputTokens,
            contextTokens: row.contextTokens,
            codingOptimized: row.codingOptimized,
            tier: row.tier,
          },
          $setOnInsert: {
            modelId: row.modelId,
            displayName: row.displayName,
            enabled: row.enabled,
            isDefault: row.isDefault,
            order: row.order,
            // Category is admin-managed (changing it server-side on every
            // boot would override admin re-classification), so it's set
            // only on insert. Existing rows keep whatever the admin set.
            category: row.category,
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );
    }

    if (RETIRED_MODEL_IDS.length > 0) {
      await this.modelModel.updateMany(
        { modelId: { $in: [...RETIRED_MODEL_IDS] } },
        {
          $set: {
            enabled: false,
            deprecatedAt: new Date('2026-07-23T00:00:00.000Z'),
            isDefault: false,
          },
        },
      );
    }

    // Guarantee exactly one default row — if nobody is flagged default
    // (e.g. someone toggled the only default off) fall back to the seed
    // manifest's default entry.
    const current = await this.modelModel.countDocuments({ isDefault: true });
    if (current === 0) {
      const seedDefault = MODEL_CATALOG_SEED.find((r) => r.isDefault);
      if (seedDefault) {
        await this.modelModel.updateOne(
          { modelId: seedDefault.modelId },
          { $set: { isDefault: true } },
        );
      }
    }
    if (current > 1) {
      // More than one default can happen if seeded pre-fix. Keep the
      // highest-order (lowest `order` number = top of list) one.
      const rows = await this.modelModel
        .find({ isDefault: true })
        .sort({ order: 1 })
        .lean();
      const keep = rows[0];
      await this.modelModel.updateMany(
        { isDefault: true, modelId: { $ne: keep.modelId } },
        { $set: { isDefault: false } },
      );
    }
  }

  async reload(): Promise<void> {
    const rows = await this.modelModel.find().lean();
    const next = new Map<string, ModelSnapshot>();
    let defaultId: string | null = null;
    for (const row of rows) {
      const snapshot = this.toSnapshot(row as unknown as AiModel);
      next.set(snapshot.modelId, snapshot);
      if (snapshot.isDefault) {
        defaultId = snapshot.modelId;
      }
    }
    this.cache = next;
    this.defaultModelId = defaultId;
    this.logger.log(
      `Model catalog reloaded (${this.cache.size} rows, default=${defaultId})`,
    );
  }

  list(): ModelSnapshot[] {
    return Array.from(this.cache.values()).sort((a, b) => a.order - b.order);
  }

  listEnabled(): ModelSnapshot[] {
    return this.list().filter((m) => m.enabled && !m.deprecatedAt);
  }

  listEnabledByCategory(category: AiModel['category']): ModelSnapshot[] {
    return this.listEnabled().filter((m) => m.category === category);
  }

  get(modelId: string): ModelSnapshot | null {
    return this.cache.get(modelId) ?? null;
  }

  getDefault(): ModelSnapshot | null {
    if (!this.defaultModelId) return null;
    return this.cache.get(this.defaultModelId) ?? null;
  }

  /**
   * Admin PATCH helper. Handles the "exactly one default" constraint
   * atomically enough for an admin panel — setting a new default clears
   * the previous one in the same write batch.
   */
  async update(
    modelId: string,
    patch: Partial<
      Pick<
        AiModel,
        | 'enabled'
        | 'displayName'
        | 'order'
        | 'isDefault'
        | 'inputPerMillion'
        | 'outputPerMillion'
        | 'maxOutputTokens'
        | 'contextTokens'
        | 'tier'
        | 'category'
        | 'codingOptimized'
      >
    >,
  ): Promise<ModelSnapshot | null> {
    if (patch.isDefault === true) {
      await this.modelModel.updateMany(
        { isDefault: true, modelId: { $ne: modelId } },
        { $set: { isDefault: false } },
      );
    }
    const updated = await this.modelModel.findOneAndUpdate(
      { modelId },
      { $set: patch },
      { new: true },
    );
    await this.reload();
    return updated ? this.toSnapshot(updated) : null;
  }

  async upsertRefreshed(
    row: SeedModel & { lastSeenAt: Date; releasedAt?: Date },
  ): Promise<'added' | 'seen'> {
    const existing = await this.modelModel.findOne({ modelId: row.modelId });
    if (existing) {
      // `releasedAt` is provider-owned, so it is refreshed on existing rows
      // too — that's what backfills models added before the column existed.
      // Admin-managed columns stay untouched, as before.
      await this.modelModel.updateOne(
        { modelId: row.modelId },
        {
          $set: {
            lastSeenAt: row.lastSeenAt,
            ...(row.releasedAt ? { releasedAt: row.releasedAt } : {}),
          },
        },
      );
      return 'seen';
    }
    await this.modelModel.create({
      ...row,
      enabled: false,
      isDefault: false,
    });
    await this.reload();
    return 'added';
  }

  /**
   * Stamp `deprecatedAt` on rows their provider has stopped listing. Rows
   * that already carry a date are skipped (`deprecatedAt: null` matches
   * missing fields in Mongo), so the value keeps meaning "first refresh that
   * missed this model" instead of drifting forward on every button press.
   *
   * Deprecation is a routing block, not a cosmetic flag: `listEnabled` drops
   * these from the picker and `ModelRouterService.isRoutable` refuses them,
   * so a retired id can no longer 404 at call time.
   */
  async markDeprecated(modelIds: string[]): Promise<void> {
    if (modelIds.length === 0) return;
    await this.modelModel.updateMany(
      { modelId: { $in: modelIds }, deprecatedAt: null },
      { $set: { deprecatedAt: new Date() } },
    );
    await this.reload();
  }

  /**
   * Undo deprecation for models a provider lists again. Without this a
   * transient provider outage would be unrecoverable from the admin UI —
   * nothing else writes `deprecatedAt`, and it isn't a PATCH-able field.
   */
  async clearDeprecated(modelIds: string[]): Promise<void> {
    if (modelIds.length === 0) return;
    await this.modelModel.updateMany(
      { modelId: { $in: modelIds } },
      { $unset: { deprecatedAt: 1 } },
    );
    await this.reload();
  }

  private toSnapshot(row: AiModel): ModelSnapshot {
    return {
      modelId: row.modelId,
      provider: row.provider,
      displayName: row.displayName,
      tier: row.tier,
      // Defensive default: rows that pre-date the category column
      // shouldn't crash the picker — treat them as coding so they remain
      // visible to users until an admin reclassifies them.
      category: row.category ?? 'coding',
      enabled: row.enabled,
      isDefault: row.isDefault,
      order: row.order,
      inputPerMillion: row.inputPerMillion,
      outputPerMillion: row.outputPerMillion,
      maxOutputTokens: row.maxOutputTokens,
      contextTokens: row.contextTokens,
      codingOptimized: row.codingOptimized,
      deprecatedAt: row.deprecatedAt,
      lastSeenAt: row.lastSeenAt,
      releasedAt: row.releasedAt,
    };
  }
}
