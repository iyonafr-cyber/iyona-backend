import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  AiTaskRoute,
  ROUTER_TASKS,
  RouterTaskName,
} from './entities/ai-task-route.entity';

export interface TaskRouteSnapshot {
  task: RouterTaskName;
  primaryModelId: string | null;
  fallbackModelIds: string[];
  enforce: boolean;
  enabled: boolean;
}

export interface TaskRoutePatch {
  primaryModelId?: string | null;
  fallbackModelIds?: string[];
  enforce?: boolean;
  enabled?: boolean;
}

/**
 * Read-through cache of the per-task routing table, mirroring
 * {@link ModelCatalogService}: writes are admin-only and the table has one
 * row per task (six today), so every write does a full reload.
 *
 * `get()` returns the cached snapshot object, so a request that has already
 * resolved its route is immune to a concurrent admin edit.
 */
@Injectable()
export class TaskRouteService implements OnModuleInit {
  private readonly logger = new Logger(TaskRouteService.name);
  private cache: Map<RouterTaskName, TaskRouteSnapshot> = new Map();

  constructor(
    @InjectModel(AiTaskRoute.name)
    private readonly routeModel: Model<AiTaskRoute>,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.seed();
    await this.reload();
  }

  /**
   * Ensure one row per task exists. Seeded rows are inert
   * (`primaryModelId: null`) so installing this feature changes no routing
   * until an admin actually configures a task.
   */
  async seed(): Promise<void> {
    for (const task of ROUTER_TASKS) {
      await this.routeModel.findOneAndUpdate(
        { task },
        {
          $setOnInsert: {
            task,
            primaryModelId: null,
            fallbackModelIds: [],
            enforce: false,
            enabled: true,
            updatedBy: null,
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );
    }
  }

  async reload(): Promise<void> {
    const rows = await this.routeModel.find().lean();
    const next = new Map<RouterTaskName, TaskRouteSnapshot>();
    for (const row of rows) {
      const r = row as unknown as AiTaskRoute;
      next.set(r.task, {
        task: r.task,
        primaryModelId: r.primaryModelId ?? null,
        fallbackModelIds: r.fallbackModelIds ?? [],
        enforce: Boolean(r.enforce),
        enabled: r.enabled !== false,
      });
    }
    this.cache = next;
    const configured = Array.from(next.values()).filter(
      (r) => r.enabled && r.primaryModelId,
    );
    this.logger.log(
      `Task routes reloaded (${next.size} rows, ${configured.length} configured)`,
    );
  }

  list(): TaskRouteSnapshot[] {
    return ROUTER_TASKS.map(
      (task) =>
        this.cache.get(task) ?? {
          task,
          primaryModelId: null,
          fallbackModelIds: [],
          enforce: false,
          enabled: true,
        },
    );
  }

  get(task: RouterTaskName): TaskRouteSnapshot | null {
    return this.cache.get(task) ?? null;
  }

  /** Ordered candidate chain for a task: primary first, then fallbacks. */
  candidates(task: RouterTaskName): string[] {
    const row = this.cache.get(task);
    if (!row || !row.enabled || !row.primaryModelId) return [];
    return [row.primaryModelId, ...row.fallbackModelIds];
  }

  async update(
    task: RouterTaskName,
    patch: TaskRoutePatch,
    actorId?: string,
  ): Promise<TaskRouteSnapshot | null> {
    const $set: Record<string, unknown> = {};
    if (patch.primaryModelId !== undefined) {
      $set.primaryModelId = patch.primaryModelId || null;
    }
    if (patch.fallbackModelIds !== undefined) {
      // De-dupe and drop the primary from the fallback chain — trying the
      // same model twice is never useful and makes the UI confusing.
      const primary =
        patch.primaryModelId !== undefined
          ? patch.primaryModelId
          : (this.cache.get(task)?.primaryModelId ?? null);
      $set.fallbackModelIds = Array.from(
        new Set(patch.fallbackModelIds),
      ).filter((id) => id && id !== primary);
    }
    if (patch.enforce !== undefined) $set.enforce = patch.enforce;
    if (patch.enabled !== undefined) $set.enabled = patch.enabled;
    $set.updatedBy =
      actorId && Types.ObjectId.isValid(actorId)
        ? new Types.ObjectId(actorId)
        : null;

    const updated = await this.routeModel
      .findOneAndUpdate({ task }, { $set }, { new: true, upsert: true })
      .exec();
    await this.reload();
    if (!updated) return null;
    return this.get(task);
  }
}
