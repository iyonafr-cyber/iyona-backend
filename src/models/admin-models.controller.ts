import {
  Body,
  Controller,
  Get,
  HttpCode,
  Logger,
  NotFoundException,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { ModelCatalogService, ModelSnapshot } from './models.service';
import { ProviderCatalogService } from './provider-catalog.service';
import { MODEL_CATEGORIES, ModelCategory } from './entities/ai-model.entity';
import { planDeprecations } from './deprecation';
import { AuthGuard } from '../auth/guards/auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorator/roles.decorator';
import { UserRole } from '../user/roles/roles.enum';

export class UpdateModelDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsString()
  displayName?: string;

  @IsOptional()
  @IsNumber()
  order?: number;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(0)
  inputPerMillion?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  outputPerMillion?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  maxOutputTokens?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  contextTokens?: number;

  @IsOptional()
  @IsIn(['high', 'medium', 'low'])
  tier?: 'high' | 'medium' | 'low';

  @IsOptional()
  @IsIn(MODEL_CATEGORIES as unknown as string[])
  category?: ModelCategory;

  @IsOptional()
  @IsBoolean()
  codingOptimized?: boolean;
}

export interface RefreshSummary {
  added: string[];
  updatedLastSeen: string[];
  skipped: string[];
  /**
   * Rows newly stamped `deprecatedAt` by this refresh — their provider
   * answered but no longer lists them. Marking is automatic because
   * deprecation is now a routing block: leaving it to a human meant the
   * signal was reported once in a modal and then lost, which is how
   * `claude-sonnet-4-5` kept routing to a retired API id and 404ing.
   */
  deprecated: string[];
  /** Rows whose provider lists them again; `deprecatedAt` was cleared. */
  restored: string[];
  /**
   * The subset of `deprecated` that was still enabled — i.e. sellable until
   * this refresh. These are the ones an admin has to look at: they may be a
   * task-route primary or somebody's project default, and both now fall
   * through to their fallback.
   */
  stale: string[];
}

/**
 * Admin-only CRUD + catalog-refresh endpoints. Locked behind
 * `AuthGuard` + `RolesGuard` + `@Roles(UserRole.ADMIN)`.
 */
@Controller('admin/models')
@UseGuards(AuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminModelsController {
  private readonly logger = new Logger(AdminModelsController.name);

  constructor(
    private readonly catalog: ModelCatalogService,
    private readonly providers: ProviderCatalogService,
  ) {}

  @Get()
  list(): { data: ModelSnapshot[] } {
    return { data: this.catalog.list() };
  }

  @Patch(':modelId')
  async update(
    @Param('modelId') modelId: string,
    @Body() body: UpdateModelDto,
  ): Promise<{ data: ModelSnapshot }> {
    const updated = await this.catalog.update(modelId, body);
    if (!updated) throw new NotFoundException('Model not found');
    return { data: updated };
  }

  /**
   * Pulls the live catalog from each configured provider, filters to
   * coding-optimised families, and upserts anything new as `enabled:
   * false` so admins must explicitly approve before users see it.
   */
  @Post('refresh')
  @HttpCode(200)
  async refresh(): Promise<{ data: RefreshSummary }> {
    const { models: remote, respondedProviders } =
      await this.providers.fetchAll();
    const now = new Date();
    const added: string[] = [];
    const updatedLastSeen: string[] = [];
    const skipped: string[] = [];

    for (const r of remote) {
      const existing = this.catalog.get(r.modelId);
      if (existing) {
        await this.catalog.upsertRefreshed({
          ...existing,
          modelId: r.modelId,
          provider: r.provider,
          lastSeenAt: now,
          releasedAt: r.releasedAt,
        });
        updatedLastSeen.push(r.modelId);
        continue;
      }
      const defaults = this.providers.suggestDefaults(r.modelId, r.provider);
      try {
        await this.catalog.upsertRefreshed({
          ...defaults,
          modelId: r.modelId,
          provider: r.provider,
          order: 500,
          isDefault: false,
          lastSeenAt: now,
          releasedAt: r.releasedAt,
        });
        added.push(r.modelId);
      } catch {
        skipped.push(r.modelId);
      }
    }

    await this.catalog.reload();

    // Reconcile against what the responding providers actually serve. Only
    // they get a vote: a provider that errored or has no key returns nothing,
    // and retiring its whole catalog on that basis would be nonsense.
    const plan = planDeprecations({
      rows: this.catalog.list(),
      seenModelIds: remote.map((r) => r.modelId),
      respondedProviders,
    });

    await this.catalog.markDeprecated(plan.deprecate);
    await this.catalog.clearDeprecated(plan.restore);

    if (plan.stale.length > 0) {
      this.logger.warn(
        `[CatalogRefresh] Enabled rows no longer listed by their provider: ` +
          `${plan.stale.join(', ')} — deprecated and removed from routing.`,
      );
    }
    if (plan.restore.length > 0) {
      this.logger.log(
        `[CatalogRefresh] Re-listed by their provider, deprecation cleared: ` +
          `${plan.restore.join(', ')}`,
      );
    }

    return {
      data: {
        added,
        updatedLastSeen,
        skipped,
        deprecated: plan.deprecate,
        restored: plan.restore,
        stale: plan.stale,
      },
    };
  }
}
