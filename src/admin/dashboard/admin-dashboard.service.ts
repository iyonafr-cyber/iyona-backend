import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User } from '../../user/entities/user.entity';
import { UserProject } from '../../projects/entities/user-project.entity';
import { UsageLog } from '../../credits/entities/usage-log.entity';
import { CreditLedger } from '../../credits/entities/credit-ledger.entity';
import { CreditsService } from '../../credits/credits.service';

type MarginSummary = Awaited<ReturnType<CreditsService['aggregateMargin']>>;
import { UserRole } from '../../user/roles/roles.enum';

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(d: Date): Date {
  const copy = new Date(d);
  copy.setUTCHours(0, 0, 0, 0);
  return copy;
}

@Injectable()
export class AdminDashboardService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<User>,
    @InjectModel(UserProject.name)
    private readonly projectModel: Model<UserProject>,
    @InjectModel(UsageLog.name)
    private readonly usageModel: Model<UsageLog>,
    @InjectModel(CreditLedger.name)
    private readonly ledgerModel: Model<CreditLedger>,
    private readonly creditsService: CreditsService,
  ) {}

  async snapshot(): Promise<DashboardSnapshot> {
    const now = new Date();
    const today = startOfDay(now);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * DAY_MS);

    const [
      totalUsers,
      totalAdmins,
      activeSubscriptions,
      totalProjects,
      deployedProjects,
    ] = await Promise.all([
      this.userModel.countDocuments({ isDeleted: { $ne: true } }).exec(),
      this.userModel
        .countDocuments({ role: UserRole.ADMIN, isDeleted: { $ne: true } })
        .exec(),
      this.userModel
        .countDocuments({
          stripeSubscriptionId: { $nin: [null, ''] },
          isDeleted: { $ne: true },
        })
        .exec(),
      this.projectModel.countDocuments({ deletedAt: null }).exec(),
      this.projectModel
        .countDocuments({ deletedAt: null, status: 'DEPLOYED' })
        .exec(),
    ]);

    const [signupsRaw, creditsConsumedRaw, providerSpendRaw] =
      await Promise.all([
        this.userModel
          .aggregate([
            { $match: { createdAt: { $gte: thirtyDaysAgo } } },
            {
              $group: {
                _id: {
                  $dateToString: { format: '%Y-%m-%d', date: '$createdAt' },
                },
                count: { $sum: 1 },
              },
            },
          ])
          .exec(),
        this.usageModel
          .aggregate([
            {
              $match: {
                createdAt: { $gte: thirtyDaysAgo },
                status: 'success',
              },
            },
            {
              $group: {
                _id: {
                  $dateToString: { format: '%Y-%m-%d', date: '$createdAt' },
                },
                credits: { $sum: '$creditsCharged' },
              },
            },
          ])
          .exec(),
        this.usageModel
          .aggregate([
            { $match: { createdAt: { $gte: thirtyDaysAgo } } },
            {
              $group: {
                _id: {
                  $dateToString: { format: '%Y-%m-%d', date: '$createdAt' },
                },
                usd: { $sum: '$actualCostUsd' },
              },
            },
          ])
          .exec(),
      ]);

    const signupsByDay = toDailySeries(
      signupsRaw as Array<{ _id: string; count: number }>,
      thirtyDaysAgo,
      'count',
    );
    const creditsByDay = toDailySeries(
      creditsConsumedRaw as Array<{ _id: string; credits: number }>,
      thirtyDaysAgo,
      'credits',
    );
    const providerSpendByDay = toDailySeries(
      providerSpendRaw as Array<{ _id: string; usd: number }>,
      thirtyDaysAgo,
      'usd',
    );

    const [todaySignups, todayUsage, todayFailedGenerations] =
      await Promise.all([
        this.userModel.countDocuments({ createdAt: { $gte: today } }).exec(),
        this.usageModel
          .aggregate<{ credits: number; usd: number }>([
            { $match: { createdAt: { $gte: today } } },
            {
              $group: {
                _id: null,
                credits: { $sum: '$creditsCharged' },
                usd: { $sum: '$actualCostUsd' },
              },
            },
          ])
          .exec(),
        this.usageModel
          .countDocuments({
            createdAt: { $gte: today },
            status: { $in: ['error', 'timeout'] },
          })
          .exec(),
      ]);

    const margin30d: MarginSummary | null = await this.creditsService
      .aggregateMargin({ days: 30 })
      .catch((): MarginSummary | null => null);

    const providerHealth = await this.computeProviderHealth();

    return {
      totals: {
        users: totalUsers,
        admins: totalAdmins,
        activeSubscriptions,
        projects: totalProjects,
        deployedProjects,
      },
      today: {
        signups: todaySignups,
        creditsConsumed: todayUsage?.[0]?.credits ?? 0,
        providerSpendUsd: todayUsage?.[0]?.usd ?? 0,
        failedGenerations: todayFailedGenerations,
      },
      timeseries: {
        signupsLast30d: signupsByDay,
        creditsConsumedLast30d: creditsByDay,
        providerSpendUsdLast30d: providerSpendByDay,
      },
      margin30d,
      providerHealth,
    };
  }

  private async computeProviderHealth(): Promise<
    Record<string, ProviderHealth>
  > {
    const since = new Date(Date.now() - DAY_MS);
    const providers = ['openai', 'anthropic', 'google'];
    const result: Record<string, ProviderHealth> = {};
    for (const provider of providers) {
      const [lastSuccess, lastFailure, successes24h, failures24h] =
        await Promise.all([
          this.usageModel
            .findOne({ provider, status: 'success' })
            .sort({ createdAt: -1 })
            .select('createdAt')
            .lean<{ createdAt?: Date }>()
            .exec(),
          this.usageModel
            .findOne({ provider, status: { $in: ['error', 'timeout'] } })
            .sort({ createdAt: -1 })
            .select('createdAt')
            .lean<{ createdAt?: Date }>()
            .exec(),
          this.usageModel
            .countDocuments({
              provider,
              status: 'success',
              createdAt: { $gte: since },
            })
            .exec(),
          this.usageModel
            .countDocuments({
              provider,
              status: { $in: ['error', 'timeout'] },
              createdAt: { $gte: since },
            })
            .exec(),
        ]);
      result[provider] = {
        lastSuccessAt: lastSuccess?.createdAt ?? null,
        lastFailureAt: lastFailure?.createdAt ?? null,
        successes24h,
        failures24h,
      };
    }
    return result;
  }
}

export interface ProviderHealth {
  lastSuccessAt: Date | null;
  lastFailureAt: Date | null;
  successes24h: number;
  failures24h: number;
}

export interface DashboardSnapshot {
  totals: {
    users: number;
    admins: number;
    activeSubscriptions: number;
    projects: number;
    deployedProjects: number;
  };
  today: {
    signups: number;
    creditsConsumed: number;
    providerSpendUsd: number;
    failedGenerations: number;
  };
  timeseries: {
    signupsLast30d: Array<{ date: string; value: number }>;
    creditsConsumedLast30d: Array<{ date: string; value: number }>;
    providerSpendUsdLast30d: Array<{ date: string; value: number }>;
  };
  margin30d: MarginSummary | null;
  providerHealth: Record<string, ProviderHealth>;
}

function toDailySeries<T extends { _id: string }>(
  rows: T[],
  since: Date,
  valueKey: keyof T,
): Array<{ date: string; value: number }> {
  const byDate = new Map<string, number>(
    rows.map((r) => [r._id, Number(r[valueKey] ?? 0)]),
  );
  const out: Array<{ date: string; value: number }> = [];
  const startUtc = startOfDay(since);
  const today = startOfDay(new Date());
  for (
    let d = new Date(startUtc);
    d.getTime() <= today.getTime();
    d = new Date(d.getTime() + DAY_MS)
  ) {
    const iso = d.toISOString().slice(0, 10);
    out.push({ date: iso, value: byDate.get(iso) ?? 0 });
  }
  return out;
}
