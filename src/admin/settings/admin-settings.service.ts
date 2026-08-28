import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AdminSettings } from './entities/admin-settings.entity';
import { AuditActor, AuditLogService } from '../audit/audit-log.service';

const SINGLETON_ID = 'singleton';

export interface AdminSettingsPatch {
  maintenanceMode?: boolean;
  maintenanceMessage?: string | null;
  /** Cursor model id used for code authorship; null resets to the env default. */
  cursorAgentModelId?: string | null;
  /**
   * Cursor model params (effort/reasoning/thinking/fast) as {paramId: value};
   * null clears them (model runs on its own defaults).
   */
  cursorAgentModelParams?: Record<string, string> | null;
}

/** Defensive bounds for the stored param record — the UI only offers values
 *  from Cursor's catalogue, but the API must not trust the client. */
const MODEL_PARAMS_MAX_ENTRIES = 8;
const MODEL_PARAM_MAX_LEN = 40;

function sanitizeModelParams(
  raw: Record<string, string> | null | undefined,
): Record<string, string> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (Object.keys(out).length >= MODEL_PARAMS_MAX_ENTRIES) break;
    if (typeof k !== 'string' || typeof v !== 'string') continue;
    const key = k.trim();
    const value = v.trim();
    if (!key || !value) continue;
    if (key.length > MODEL_PARAM_MAX_LEN || value.length > MODEL_PARAM_MAX_LEN)
      continue;
    out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : null;
}

@Injectable()
export class AdminSettingsService {
  constructor(
    @InjectModel(AdminSettings.name)
    private readonly settingsModel: Model<AdminSettings>,
    private readonly audit: AuditLogService,
  ) {}

  async get(): Promise<AdminSettings> {
    const existing = await this.settingsModel.findById(SINGLETON_ID).lean();
    if (existing) return existing as AdminSettings;
    // Lazy-init on first read so we always have a row to patch.
    const created = await this.settingsModel.create({
      _id: SINGLETON_ID,
      maintenanceMode: false,
      maintenanceMessage: null,
      updatedBy: null,
    });
    return created.toObject() as unknown as AdminSettings;
  }

  async update(
    dto: AdminSettingsPatch,
    actor: AuditActor,
  ): Promise<AdminSettings> {
    const before = await this.get();

    const update: Record<string, unknown> = {};
    if (dto.maintenanceMode !== undefined) {
      update.maintenanceMode = dto.maintenanceMode;
    }
    if (dto.maintenanceMessage !== undefined) {
      update.maintenanceMessage = dto.maintenanceMessage;
    }
    if (dto.cursorAgentModelId !== undefined) {
      const trimmed = dto.cursorAgentModelId?.trim();
      update.cursorAgentModelId = trimmed ? trimmed : null;
    }
    if (dto.cursorAgentModelParams !== undefined) {
      update.cursorAgentModelParams = sanitizeModelParams(
        dto.cursorAgentModelParams,
      );
    }
    update.updatedBy = Types.ObjectId.isValid(actor.actorId)
      ? new Types.ObjectId(actor.actorId)
      : null;

    await this.settingsModel
      .updateOne({ _id: SINGLETON_ID }, { $set: update }, { upsert: true })
      .exec();

    const after = await this.get();

    if (
      dto.maintenanceMode !== undefined &&
      dto.maintenanceMode !== before.maintenanceMode
    ) {
      await this.audit.log(actor, {
        action: dto.maintenanceMode
          ? 'system.maintenance.enabled'
          : 'system.maintenance.disabled',
        targetType: 'system',
        targetId: SINGLETON_ID,
        before: { maintenanceMode: before.maintenanceMode },
        after: { maintenanceMode: dto.maintenanceMode },
      });
    }
    if (
      (dto.cursorAgentModelId !== undefined &&
        after.cursorAgentModelId !== before.cursorAgentModelId) ||
      (dto.cursorAgentModelParams !== undefined &&
        JSON.stringify(after.cursorAgentModelParams ?? null) !==
          JSON.stringify(before.cursorAgentModelParams ?? null))
    ) {
      await this.audit.log(actor, {
        action: 'system.cursorAgentModel.changed',
        targetType: 'system',
        targetId: SINGLETON_ID,
        before: {
          cursorAgentModelId: before.cursorAgentModelId ?? null,
          cursorAgentModelParams: before.cursorAgentModelParams ?? null,
        },
        after: {
          cursorAgentModelId: after.cursorAgentModelId ?? null,
          cursorAgentModelParams: after.cursorAgentModelParams ?? null,
        },
      });
    }
    if (
      dto.maintenanceMessage !== undefined &&
      dto.maintenanceMessage !== before.maintenanceMessage
    ) {
      await this.audit.log(actor, {
        action: 'system.maintenance.message',
        targetType: 'system',
        targetId: SINGLETON_ID,
        before: { maintenanceMessage: before.maintenanceMessage },
        after: { maintenanceMessage: dto.maintenanceMessage },
      });
    }

    return after;
  }

  async publicStatus(): Promise<{
    maintenance: boolean;
    message: string | null;
  }> {
    const s = await this.get();
    return {
      maintenance: !!s.maintenanceMode,
      message: s.maintenanceMessage ?? null,
    };
  }
}
