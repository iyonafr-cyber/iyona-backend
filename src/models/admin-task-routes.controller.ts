import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiProperty,
  ApiTags,
} from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
} from 'class-validator';
import { ModelCatalogService } from './models.service';
import { TaskRouteService, TaskRouteSnapshot } from './task-routes.service';
import {
  ROUTER_TASKS,
  ROUTER_TASK_DESCRIPTIONS,
  RouterTaskName,
} from './entities/ai-task-route.entity';
import { AiProviderRouterService } from '../ai-provider-keys/ai-provider-router.service';
import {
  AdminRequest,
  AuditLogService,
} from '../admin/audit/audit-log.service';
import { AuthGuard } from '../auth/guards/auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorator/roles.decorator';
import { UserRole } from '../user/roles/roles.enum';

export class UpdateTaskRouteDto {
  @ApiProperty({
    required: false,
    nullable: true,
    description: 'First-choice model id. Null/empty clears the route.',
  })
  @IsOptional()
  @IsString()
  primaryModelId?: string | null;

  @ApiProperty({
    required: false,
    type: [String],
    description: 'Ordered secondary chain, tried after the primary.',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(5)
  fallbackModelIds?: string[];

  @ApiProperty({
    required: false,
    description:
      'When true, this route also overrides the per-request model picker and the per-project default.',
  })
  @IsOptional()
  @IsBoolean()
  enforce?: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

/** One candidate in the chain, annotated with why it would or wouldn't run. */
export interface TaskRouteCandidateView {
  modelId: string;
  displayName: string | null;
  provider: string | null;
  role: 'primary' | 'fallback';
  /** Present in the catalog, enabled, and provider has a healthy key. */
  available: boolean;
  reason:
    | 'ok'
    | 'unknown_model'
    | 'model_disabled'
    | 'model_deprecated'
    | 'provider_unavailable';
}

export interface TaskRouteView extends TaskRouteSnapshot {
  description: string;
  candidates: TaskRouteCandidateView[];
  /** Model this task resolves to right now, given live provider health. */
  effectiveModelId: string | null;
  effectiveSource:
    | 'taskRoutePrimary'
    | 'taskRouteFallback'
    | 'globalDefault'
    | 'legacyTable';
}

/**
 * Admin CRUD for per-task model routing (primary + ordered fallbacks).
 *
 * The `GET` response is deliberately fat: it resolves each candidate against
 * live provider health so the panel can show what a task *actually* routes to
 * today, not just what was configured. Without that, a configured-but-dead
 * primary looks identical to a working one.
 */
@ApiTags('admin-task-routes')
@Controller('admin/task-routes')
@UseGuards(AuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@ApiBearerAuth('JWT-auth')
export class AdminTaskRoutesController {
  constructor(
    private readonly routes: TaskRouteService,
    private readonly catalog: ModelCatalogService,
    private readonly providerRouter: AiProviderRouterService,
    private readonly audit: AuditLogService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'List per-task routing config with live resolution',
  })
  async list(): Promise<{ data: TaskRouteView[] }> {
    await this.providerRouter.ensureCache();
    const availability = this.providerRouter.getLastAvailabilitySync();
    return {
      data: this.routes.list().map((row) => this.toView(row, availability)),
    };
  }

  @Patch(':task')
  @ApiOperation({ summary: 'Update routing for one task' })
  async update(
    @Param('task') task: string,
    @Body() body: UpdateTaskRouteDto,
    @Req() req: AdminRequest,
  ): Promise<{ data: TaskRouteView }> {
    if (!ROUTER_TASKS.includes(task as RouterTaskName)) {
      throw new NotFoundException(`Unknown task: ${task}`);
    }
    const typedTask = task as RouterTaskName;

    // Reject unknown model ids up front — silently storing a typo would
    // surface much later as an unexplained fallback.
    for (const id of [
      ...(body.primaryModelId ? [body.primaryModelId] : []),
      ...(body.fallbackModelIds ?? []),
    ]) {
      if (!this.catalog.get(id)) {
        throw new NotFoundException(`Unknown model: ${id}`);
      }
    }

    const actor = AuditLogService.actorFromRequest(req);
    const before = this.routes.get(typedTask);
    const updated = await this.routes.update(typedTask, body, actor.actorId);
    if (!updated) throw new NotFoundException('Task route not found');

    await this.audit.log(actor, {
      action: 'ai_task_route.updated',
      targetType: 'system',
      targetId: typedTask,
      before: before
        ? {
            primaryModelId: before.primaryModelId,
            fallbackModelIds: before.fallbackModelIds,
            enforce: before.enforce,
            enabled: before.enabled,
          }
        : null,
      after: {
        primaryModelId: updated.primaryModelId,
        fallbackModelIds: updated.fallbackModelIds,
        enforce: updated.enforce,
        enabled: updated.enabled,
      },
    });

    await this.providerRouter.ensureCache();
    return {
      data: this.toView(updated, this.providerRouter.getLastAvailabilitySync()),
    };
  }

  private toView(
    row: TaskRouteSnapshot,
    availability: Record<string, boolean>,
  ): TaskRouteView {
    const ids = row.primaryModelId
      ? [row.primaryModelId, ...row.fallbackModelIds]
      : [];

    const candidates: TaskRouteCandidateView[] = ids.map((modelId, index) => {
      const model = this.catalog.get(modelId);
      const role = index === 0 ? ('primary' as const) : ('fallback' as const);
      if (!model) {
        return {
          modelId,
          displayName: null,
          provider: null,
          role,
          available: false,
          reason: 'unknown_model',
        };
      }
      const providerUp = availability[model.provider] === true;
      // Mirrors `ModelRouterService.isRoutable`. A deprecated row is skipped
      // by the router, so reporting it as available here would have the panel
      // name a primary that never actually answers.
      const deprecated = Boolean(model.deprecatedAt);
      const available =
        model.enabled && !deprecated && providerUp && row.enabled;
      return {
        modelId,
        displayName: model.displayName,
        provider: model.provider,
        role,
        available,
        reason: deprecated
          ? 'model_deprecated'
          : !model.enabled
            ? 'model_disabled'
            : !providerUp
              ? 'provider_unavailable'
              : 'ok',
      };
    });

    const hit = row.enabled ? candidates.find((c) => c.available) : undefined;
    if (hit) {
      return {
        ...row,
        description: ROUTER_TASK_DESCRIPTIONS[row.task],
        candidates,
        effectiveModelId: hit.modelId,
        effectiveSource:
          hit.role === 'primary' ? 'taskRoutePrimary' : 'taskRouteFallback',
      };
    }

    // Nothing in the chain is usable — mirror the router's own fall-through
    // so the panel shows the model that will really answer.
    const globalDefault = this.catalog.getDefault();
    if (
      globalDefault &&
      globalDefault.enabled &&
      !globalDefault.deprecatedAt &&
      availability[globalDefault.provider] === true
    ) {
      return {
        ...row,
        description: ROUTER_TASK_DESCRIPTIONS[row.task],
        candidates,
        effectiveModelId: globalDefault.modelId,
        effectiveSource: 'globalDefault',
      };
    }

    return {
      ...row,
      description: ROUTER_TASK_DESCRIPTIONS[row.task],
      candidates,
      effectiveModelId: null,
      effectiveSource: 'legacyTable',
    };
  }
}
