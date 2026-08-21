import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Request } from 'express';
import {
  AdminAuditLog,
  AuditTargetType,
} from './entities/admin-audit-log.entity';

/**
 * Shape of an Express request after `AuthGuard` has run. `fullUser` is
 * stamped on the request object at line 97 of `auth.guard.ts`. We pull
 * the minimum fields we need here so admin controllers don't leak `any`.
 */
export type AdminRequest = Request & {
  fullUser?: {
    _id?: Types.ObjectId | string | null;
    email?: string | null;
  };
};

export interface AuditActor {
  actorId: string;
  actorEmail: string;
  ip?: string | null;
  userAgent?: string | null;
}

export interface AuditEntry {
  action: string;
  targetType: AuditTargetType;
  targetId?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  reason?: string | null;
}

export interface AuditQueryFilters {
  actorId?: string;
  action?: string;
  targetType?: AuditTargetType;
  targetId?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

/**
 * Thin persistence wrapper around the `admin_audit_logs` collection.
 * Admin services call `log()` explicitly after every mutating action;
 * we do not attach a global interceptor because the `before`/`after`
 * snapshots are only meaningful when the service knows them.
 */
@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);

  constructor(
    @InjectModel(AdminAuditLog.name)
    private readonly auditModel: Model<AdminAuditLog>,
  ) {}

  /**
   * Derive actor metadata (including IP + user-agent) from an Express
   * request plus the `fullUser` decorated on it by `AuthGuard`.
   */
  static actorFromRequest(req: AdminRequest): AuditActor {
    const user = req.fullUser;
    const rawId = user?._id;
    const actorId =
      rawId instanceof Types.ObjectId
        ? rawId.toHexString()
        : typeof rawId === 'string'
          ? rawId
          : '';
    return {
      actorId,
      actorEmail: user?.email ?? '',
      ip:
        (req.headers['x-forwarded-for'] as string | undefined)
          ?.split(',')[0]
          ?.trim() ||
        req.ip ||
        null,
      userAgent: req.headers['user-agent'] ?? null,
    };
  }

  async log(actor: AuditActor, entry: AuditEntry): Promise<void> {
    try {
      await this.auditModel.create({
        actorId: new Types.ObjectId(actor.actorId),
        actorEmail: actor.actorEmail,
        action: entry.action,
        targetType: entry.targetType,
        targetId: entry.targetId ?? null,
        before: entry.before ?? null,
        after: entry.after ?? null,
        reason: entry.reason ?? null,
        ip: actor.ip ?? null,
        userAgent: actor.userAgent ?? null,
      });
    } catch (err) {
      // Audit failures must not break the user-facing admin action. We log
      // loudly so infra alerting can pick it up.
      this.logger.error(
        `Failed to write audit log for action=${entry.action}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  async query(filters: AuditQueryFilters): Promise<{
    items: AdminAuditLog[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const page = Math.max(1, Number(filters.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(filters.pageSize) || 25));
    const where: Record<string, unknown> = {};

    if (filters.actorId && Types.ObjectId.isValid(filters.actorId)) {
      where.actorId = new Types.ObjectId(filters.actorId);
    }
    if (filters.action) where.action = filters.action;
    if (filters.targetType) where.targetType = filters.targetType;
    if (filters.targetId) where.targetId = filters.targetId;

    if (filters.from || filters.to) {
      const createdAt: Record<string, Date> = {};
      if (filters.from) createdAt.$gte = new Date(filters.from);
      if (filters.to) createdAt.$lte = new Date(filters.to);
      where.createdAt = createdAt;
    }

    const [items, total] = await Promise.all([
      this.auditModel
        .find(where)
        .sort({ createdAt: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .lean()
        .exec() as unknown as Promise<AdminAuditLog[]>,
      this.auditModel.countDocuments(where).exec(),
    ]);

    return { items, total, page, pageSize };
  }
}
