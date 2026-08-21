import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { randomBytes } from 'crypto';
import { User } from '../../user/entities/user.entity';
import { UserProject } from '../../projects/entities/user-project.entity';
import { CreditLedger } from '../../credits/entities/credit-ledger.entity';
import { UserRole } from '../../user/roles/roles.enum';
import { AuditActor, AuditLogService } from '../audit/audit-log.service';
import { EmailService } from '../../email/email.service';

export interface AdminUserListQuery {
  q?: string;
  role?: UserRole;
  planId?: string;
  isVerified?: string;
  isDeleted?: string;
  isSuspended?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
  sort?: string;
}

export interface AdminUserPatch {
  role?: UserRole;
  planId?: string;
  isVerified?: boolean;
  isDeleted?: boolean;
  isSuspended?: boolean;
  reason?: string;
}

const SAFE_USER_PROJECTION = {
  password: 0,
  sessionIds: 0,
  verificationToken: 0,
} as const;

type UserLeanDoc = {
  _id: Types.ObjectId;
  email: string;
  role: UserRole;
  planId: string;
  credits: number;
  topUpCredits: number;
  isVerified: boolean;
  isDeleted: boolean;
  isSuspended?: boolean;
  stripeSubscriptionId?: string | null;
  lastLoginAt?: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
  manualSubscription?: {
    planId: string;
    startedAt: Date;
    expiresAt: Date;
    months: number;
    amountPaidCents: number;
    currency: string;
    grantedBy: Types.ObjectId | string;
    note: string | null;
  } | null;
};

/**
 * Admin-facing user CRUD. Every mutating method emits an `admin_audit_logs`
 * row with explicit before/after snapshots so operators have a full paper
 * trail (plan §A3, §C1.3).
 */
@Injectable()
export class AdminUsersService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<User>,
    @InjectModel(UserProject.name)
    private readonly projectModel: Model<UserProject>,
    @InjectModel(CreditLedger.name)
    private readonly ledgerModel: Model<CreditLedger>,
    private readonly audit: AuditLogService,
    private readonly emailService: EmailService,
  ) {}

  async list(query: AdminUserListQuery): Promise<{
    items: any[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 25));
    const where: Record<string, unknown> = {};

    if (query.q) {
      const rx = new RegExp(escapeRegex(query.q.trim()), 'i');
      where.email = rx;
    }
    if (query.role) where.role = query.role;
    if (query.planId) where.planId = query.planId;
    if (query.isVerified === 'true') where.isVerified = true;
    if (query.isVerified === 'false') where.isVerified = false;
    if (query.isDeleted === 'true') where.isDeleted = true;
    if (query.isDeleted === 'false') where.isDeleted = false;
    if (query.isSuspended === 'true') where.isSuspended = true;
    if (query.isSuspended === 'false') where.isSuspended = false;

    if (query.from || query.to) {
      const createdAt: Record<string, Date> = {};
      if (query.from) createdAt.$gte = new Date(query.from);
      if (query.to) createdAt.$lte = new Date(query.to);
      where.createdAt = createdAt;
    }

    const sortRaw = (query.sort ?? '-createdAt').trim();
    const sort: Record<string, 1 | -1> = sortRaw.startsWith('-')
      ? { [sortRaw.slice(1)]: -1 }
      : { [sortRaw]: 1 };

    const [items, total] = await Promise.all([
      this.userModel
        .find(where, SAFE_USER_PROJECTION)
        .sort(sort)
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .lean()
        .exec(),
      this.userModel.countDocuments(where).exec(),
    ]);

    return { items, total, page, pageSize };
  }

  async detail(userId: string): Promise<{
    user: UserLeanDoc;
    stats: {
      projectsCount: number;
      creditsBalance: number;
      topUpCredits: number;
      totalCredits: number;
    };
    recentProjects: unknown[];
    recentLedger: unknown[];
  }> {
    if (!Types.ObjectId.isValid(userId)) {
      throw new NotFoundException('User not found');
    }
    const user = (await this.userModel
      .findById(userId, SAFE_USER_PROJECTION)
      .lean()
      .exec()) as UserLeanDoc | null;
    if (!user) throw new NotFoundException('User not found');

    const objectId = new Types.ObjectId(userId);
    const [projectsCount, recentProjects, recentLedger] = await Promise.all([
      this.projectModel
        .countDocuments({ userId: objectId, deletedAt: null })
        .exec(),
      this.projectModel
        .find({ userId: objectId, deletedAt: null })
        .sort({ createdAt: -1 })
        .limit(5)
        .select('name status stage deployment createdAt updatedAt')
        .lean()
        .exec(),
      this.ledgerModel
        .find({ userId: objectId })
        .sort({ createdAt: -1 })
        .limit(10)
        .lean()
        .exec(),
    ]);

    return {
      user,
      stats: {
        projectsCount,
        creditsBalance: user.credits ?? 0,
        topUpCredits: user.topUpCredits ?? 0,
        totalCredits: (user.credits ?? 0) + (user.topUpCredits ?? 0),
      },
      recentProjects,
      recentLedger,
    };
  }

  async patch(userId: string, dto: AdminUserPatch, actor: AuditActor) {
    if (!Types.ObjectId.isValid(userId)) {
      throw new NotFoundException('User not found');
    }
    const existing = await this.userModel.findById(userId);
    if (!existing) throw new NotFoundException('User not found');
    const existingData = existing.toObject() as UserLeanDoc & {
      isSuspended?: boolean;
    };

    const update: Record<string, unknown> = {};

    if (dto.role !== undefined && dto.role !== existingData.role) {
      if (dto.role === UserRole.ADMIN && !dto.reason?.trim()) {
        throw new BadRequestException(
          'A non-empty reason is required to grant the ADMIN role',
        );
      }
      update.role = dto.role;
    }
    if (dto.planId !== undefined && dto.planId !== existingData.planId) {
      update.planId = dto.planId;
    }
    if (
      dto.isVerified !== undefined &&
      dto.isVerified !== existingData.isVerified
    ) {
      update.isVerified = dto.isVerified;
    }
    if (
      dto.isDeleted !== undefined &&
      dto.isDeleted !== existingData.isDeleted
    ) {
      update.isDeleted = dto.isDeleted;
    }
    if (
      dto.isSuspended !== undefined &&
      dto.isSuspended !== (existingData.isSuspended ?? false)
    ) {
      update.isSuspended = dto.isSuspended;
    }

    if (Object.keys(update).length === 0) {
      return this.detail(userId);
    }

    // Revoking verification / suspending / deleting wipes active sessions
    // so the user is kicked out of jarvis-front immediately.
    const shouldWipeSessions =
      update.isDeleted === true ||
      update.isSuspended === true ||
      update.isVerified === false;
    if (shouldWipeSessions) {
      update.sessionIds = [];
    }

    await this.userModel.findByIdAndUpdate(userId, { $set: update }).exec();

    const snapshot = existingData as Record<string, unknown>;
    for (const field of Object.keys(update)) {
      if (field === 'sessionIds') continue;
      await this.audit.log(actor, {
        action: `user.${field}.changed`,
        targetType: 'user',
        targetId: userId,
        before: { [field]: snapshot[field] ?? null },
        after: { [field]: update[field] },
        reason: dto.reason ?? null,
      });
    }
    if (shouldWipeSessions) {
      await this.audit.log(actor, {
        action: 'user.sessions.wiped',
        targetType: 'user',
        targetId: userId,
        reason: dto.reason ?? null,
      });
    }

    return this.detail(userId);
  }

  async forceLogout(userId: string, actor: AuditActor): Promise<void> {
    if (!Types.ObjectId.isValid(userId)) {
      throw new NotFoundException('User not found');
    }
    const user = await this.userModel.findById(userId);
    if (!user) throw new NotFoundException('User not found');

    await this.userModel
      .findByIdAndUpdate(userId, { $set: { sessionIds: [] } })
      .exec();

    await this.audit.log(actor, {
      action: 'user.force_logout',
      targetType: 'user',
      targetId: userId,
      before: { sessionCount: (user.sessionIds ?? []).length },
      after: { sessionCount: 0 },
    });
  }

  /**
   * Regenerate the verification token and deliver it via EmailService. The
   * raw token is never returned to the admin UI — only an opaque "sent"
   * acknowledgement — so it can't be screenshot-leaked from a toast.
   */
  async resendVerification(
    userId: string,
    actor: AuditActor,
  ): Promise<{ sent: boolean; email: string }> {
    if (!Types.ObjectId.isValid(userId)) {
      throw new NotFoundException('User not found');
    }
    const user = await this.userModel.findById(userId);
    if (!user) throw new NotFoundException('User not found');

    const verificationToken = randomBytes(24).toString('hex');
    await this.userModel
      .findByIdAndUpdate(userId, { $set: { verificationToken } })
      .exec();

    const baseUrl =
      process.env.FRONTEND_BASE_URL?.replace(/\/$/, '') ||
      'https://jarvis.site';
    const url = `${baseUrl}/verify-email?token=${encodeURIComponent(verificationToken)}&email=${encodeURIComponent(user.email)}`;
    await this.emailService.send({
      to: user.email,
      subject: 'Verify your Jarvis email',
      html: `
        <p>Hi,</p>
        <p>Your Jarvis administrator asked us to re-send your verification link.</p>
        <p><a href="${url}">Click here to verify your email address</a>.</p>
      `,
      text: `Verify your Jarvis email: ${url}`,
    });

    await this.audit.log(actor, {
      action: 'user.verification.resent',
      targetType: 'user',
      targetId: userId,
    });

    return { sent: true, email: user.email };
  }
}

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
