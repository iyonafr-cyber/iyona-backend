import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AiProviderRouterService } from '../ai-provider-keys/ai-provider-router.service';
import { ModelCatalogService, ModelSnapshot } from './models.service';
import { AuthGuard } from '../auth/guards/auth.guard';
import { MODEL_CATEGORIES, ModelCategory } from './entities/ai-model.entity';

export interface PublicModelDto {
  modelId: string;
  displayName: string;
  provider: ModelSnapshot['provider'];
  tier: ModelSnapshot['tier'];
  category: ModelSnapshot['category'];
  isDefault: boolean;
  order: number;
  /** False when no healthy DB-backed key exists for this model's provider. */
  providerAvailable: boolean;
}

/**
 * Public-facing endpoint the picker reads on app mount. Only enabled
 * rows are returned; pricing / capability fields are intentionally
 * omitted (users don't need to see provider costs).
 *
 * Defaults to the `coding` category — the user surfaces (chat input,
 * per-project default) all send coding prompts, so they should not be
 * able to pick image-generation or content-writing models. Pass
 * `?category=image|content` if a future surface needs a different bucket.
 */
/**
 * Single source of truth for "which models may a picker show". Both the
 * authenticated and the public endpoint call this, so the signed-out home
 * picker can never drift from the signed-in one — the drift that the old
 * hardcoded `homeModels.ts` list caused.
 */
async function listPickableModels(
  catalog: ModelCatalogService,
  providerRouter: AiProviderRouterService,
  category?: string,
): Promise<PublicModelDto[]> {
  await providerRouter.ensureCache();

  const requested = (category ?? 'coding').toLowerCase();
  const effective: ModelCategory = (
    MODEL_CATEGORIES as unknown as string[]
  ).includes(requested)
    ? (requested as ModelCategory)
    : 'coding';

  const candidates = catalog.listEnabledByCategory(effective);
  const availability = await Promise.all(
    candidates.map(async (m) => ({
      model: m,
      available: await providerRouter.isModelAvailable(m.provider, m.modelId),
    })),
  );

  return availability
    .filter((m) => m.available)
    .map<PublicModelDto>(({ model: m, available }) => ({
      modelId: m.modelId,
      displayName: m.displayName,
      provider: m.provider,
      tier: m.tier,
      category: m.category,
      isDefault: m.isDefault,
      order: m.order,
      providerAvailable: available,
    }));
}

/**
 * Unauthenticated twin of {@link ModelsController.list} for the signed-out
 * home-page picker, which needs the catalog *before* the user has a token.
 *
 * Exposes nothing sensitive: model ids and display names only, no pricing
 * and no key material. Rate-limited since it is open to the internet.
 */
@ApiTags('models')
@Controller('models')
export class PublicModelsController {
  constructor(
    private readonly catalog: ModelCatalogService,
    private readonly providerRouter: AiProviderRouterService,
  ) {}

  @Get('public')
  @Throttle({ medium: { limit: 60, ttl: 60_000 } })
  @ApiOperation({
    summary: 'List enabled models (no auth) for the signed-out picker',
  })
  async list(
    @Query('category') category?: string,
  ): Promise<{ data: PublicModelDto[] }> {
    return {
      data: await listPickableModels(
        this.catalog,
        this.providerRouter,
        category,
      ),
    };
  }
}

@ApiTags('models')
@Controller('models')
@UseGuards(AuthGuard)
@ApiBearerAuth('JWT-auth')
export class ModelsController {
  constructor(
    private readonly catalog: ModelCatalogService,
    private readonly providerRouter: AiProviderRouterService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List enabled models for the picker' })
  @ApiQuery({
    name: 'category',
    required: false,
    enum: MODEL_CATEGORIES as unknown as string[],
    description:
      'Capability bucket to filter on. Defaults to "coding" so non-coding models never surface in the user picker.',
  })
  async list(
    @Query('category') category?: string,
  ): Promise<{ data: PublicModelDto[] }> {
    return {
      data: await listPickableModels(
        this.catalog,
        this.providerRouter,
        category,
      ),
    };
  }
}
