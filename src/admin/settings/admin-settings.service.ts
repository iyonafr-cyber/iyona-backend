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
