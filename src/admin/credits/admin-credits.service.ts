import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  CreditLedger,
  CreditLedgerType,
} from '../../credits/entities/credit-ledger.entity';
import { UsageLog } from '../../credits/entities/usage-log.entity';
import { User } from '../../user/entities/user.entity';
import { CreditBalance, CreditsService } from '../../credits/credits.service';
import { AuditActor, AuditLogService } from '../audit/audit-log.service';

export interface LedgerQuery {
  userId?: string;
  type?: CreditLedgerType;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

export interface TopSpenderRow {
  userId: Types.ObjectId | string;
  email: string | null;
  requests: number;
  totalCostUsd: number;
  totalCreditsCharged: number;
}

@Injectable()
export class AdminCreditsService {
  constructor(
    @InjectModel(CreditLedger.name)
    private readonly ledgerModel: Model<CreditLedger>,
    @InjectModel(UsageLog.name)
    private readonly usageModel: Model<UsageLog>,
    @InjectModel(User.name) private readonly userModel: Model<User>,
    private readonly creditsService: CreditsService,
    private readonly audit: AuditLogService,
  ) {}

  async queryLedger(query: LedgerQuery): Promise<{
    items: any[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 25));
    const where: Record<string, unknown> = {};
    if (query.userId && Types.ObjectId.isValid(query.userId)) {
      where.userId = new Types.ObjectId(query.userId);
    }
    if (query.type) where.type = query.type;
    if (query.from || query.to) {
      const createdAt: Record<string, Date> = {};
      if (query.from) createdAt.$gte = new Date(query.from);
      if (query.to) createdAt.$lte = new Date(query.to);
      where.createdAt = createdAt;
    }

    const [rawItems, total] = await Promise.all([
      this.ledgerModel
        .find(where)
        .sort({ createdAt: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .lean()
        .exec(),
      this.ledgerModel.countDocuments(where).exec(),
    ]);

    const rows = rawItems as unknown as Array<
      Record<string, unknown> & { userId?: Types.ObjectId | string }
    >;
    const userIds = Array.from(
      new Set(rows.map((r) => String(r.userId ?? ''))),
    ).filter((id) => Types.ObjectId.isValid(id));
    const users = userIds.length
      ? ((await this.userModel
          .find({ _id: { $in: userIds.map((id) => new Types.ObjectId(id)) } })
          .select('email role')
          .lean()
          .exec()) as Array<{ _id: Types.ObjectId; email: string }>)
      : [];
    const emailById = new Map(users.map((u) => [String(u._id), u.email]));
    const items = rows.map((row) => ({
      ...row,
      userEmail: emailById.get(String(row.userId ?? '')) ?? null,
    }));

    return { items, total, page, pageSize };
  }

  async topSpenders(params: {
    days: number;
    limit: number;
  }): Promise<TopSpenderRow[]> {
    const days = Math.min(Math.max(Number(params.days) || 30, 1), 365);
    const limit = Math.min(Math.max(Number(params.limit) || 10, 1), 50);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const rows = (await this.usageModel
      .aggregate([
        { $match: { createdAt: { $gte: since }, status: 'success' } },
        {
          $group: {
            _id: '$userId',
            requests: { $sum: 1 },
            totalCostUsd: { $sum: '$actualCostUsd' },
            totalCreditsCharged: { $sum: '$creditsCharged' },
          },
        },
        { $sort: { totalCostUsd: -1 } },
        { $limit: limit },
        {
          $lookup: {
            from: 'users',
            localField: '_id',
            foreignField: '_id',
            as: 'user',
          },
        },
        { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
        {
          $project: {
            _id: 0,
            userId: '$_id',
            email: '$user.email',
            requests: 1,
            totalCostUsd: 1,
            totalCreditsCharged: 1,
          },
        },
      ])
      .exec()) as TopSpenderRow[];

    return rows;
  }

  async adjustWithAudit(
    dto: {
      userId: string;
      amount: number;
      bucket?: 'monthly' | 'topup';
      reason: string;
    },
    actor: AuditActor,
  ): Promise<CreditBalance> {
    const before = await this.creditsService.getBalance(dto.userId);
    const balance = await this.creditsService.adminAdjust({
      userId: dto.userId,
      amount: dto.amount,
      bucket: dto.bucket,
      reason: dto.reason,
      operatorId: actor.actorId,
    });

    await this.audit.log(actor, {
      action: 'credits.adjusted',
      targetType: 'credits',
      targetId: dto.userId,
      before: {
        credits: before.credits,
        topUpCredits: before.topUpCredits,
        total: before.total,
      },
      after: {
        credits: balance.credits,
        topUpCredits: balance.topUpCredits,
        total: balance.total,
      },
      reason: dto.reason,
    });

    return balance;
  }
}
