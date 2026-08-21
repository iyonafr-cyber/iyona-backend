import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Cron } from '@nestjs/schedule';
import { UserProject } from './entities/user-project.entity';
import { ProjectAccessService } from './project-access.service';
import { VercelService } from '../vercel/vercel.service';

export interface DnsRecord {
  type: string;
  name: string;
  value: string;
}

export interface VerificationRecord {
  type: string;
  domain: string;
  value: string;
  reason: string;
}

export interface CustomDomainStatusDto {
  domain: string;
  verified: boolean;
  dnsRecords?: DnsRecord[];
  verification?: VerificationRecord[];
  misconfigured?: boolean;
  configuredBy?: string | null;
  /**
   * Set when the most recent Vercel refresh failed and the verified /
   * misconfigured fields are based on a previous response. The UI uses
   * this to render a "status may be stale, last refreshed at X" hint.
   */
  staleSince?: string;
}

const DOMAIN_REGEX = /^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i;

@Injectable()
export class CustomDomainService {
  private readonly logger = new Logger(CustomDomainService.name);

  constructor(
    @InjectModel(UserProject.name)
    private readonly userProjectModel: Model<UserProject>,
    private readonly access: ProjectAccessService,
    private readonly vercel: VercelService,
  ) {}

  private vercelProjectName(projectId: string): string {
    return `jarvis-${projectId}`;
  }

  private async loadProject(projectId: string) {
    const project = await this.userProjectModel.findById(projectId).exec();
    if (!project || project.deletedAt) {
      throw new NotFoundException(`Project with ID ${projectId} not found`);
    }
    return project;
  }

  /** Build DNS advice for the owner. Vercel will typically ask for either
   * an A record or a CNAME depending on whether the domain is an apex or a
   * subdomain. */
  private buildDnsRecords(domain: string): DnsRecord[] {
    const parts = domain.split('.');
    const isApex = parts.length === 2;
    if (isApex) {
      return [{ type: 'A', name: '@', value: '76.76.21.21' }];
    }
    const subdomain = parts.slice(0, -2).join('.');
    return [{ type: 'CNAME', name: subdomain, value: 'cname.vercel-dns.com' }];
  }

  async getStatus(
    projectId: string,
    userId: string,
  ): Promise<CustomDomainStatusDto | null> {
    await this.access.requireOwnerOrAdmin(userId, projectId);
    const project = await this.loadProject(projectId);

    const domain = project.customDomain;
    if (!domain) return null;

    const stored = (project.domainConfig || {}) as {
      verification?: VerificationRecord[];
      misconfigured?: boolean;
      configuredBy?: string | null;
      staleSince?: Date | string;
    };

    const dnsRecords = this.buildDnsRecords(domain);

    let verified = project.domainVerified ?? false;
    let verification = stored.verification;
    let misconfigured = stored.misconfigured ?? false;
    let configuredBy = stored.configuredBy ?? null;
    let staleSince: Date | string | undefined = stored.staleSince;

    try {
      const vercelDomain = await this.vercel.verifyProjectDomain(
        this.vercelProjectName(projectId),
        domain,
      );
      verified = Boolean(vercelDomain.verified);
      verification = vercelDomain.verification;

      const cfg = await this.vercel.getDomainConfig(domain);
      misconfigured = Boolean(cfg.misconfigured);
      configuredBy = cfg.configuredBy ?? null;
      staleSince = undefined;

      await this.userProjectModel
        .updateOne(
          { _id: project._id },
          {
            $set: {
              domainVerified: verified,
              domainConfig: {
                verification,
                misconfigured,
                configuredBy,
                updatedAt: new Date(),
              },
            },
          },
        )
        .exec();
    } catch (err) {
      // E5 — Vercel refresh failures used to silently fall back to the
      // last-cached state, which made it impossible for the UI to
      // distinguish "nothing has changed" from "we couldn't reach Vercel".
      // Stamp `staleSince` so the settings panel can render a "status
      // possibly outdated, last refreshed at …" notice and trigger a
      // retry, while keeping whatever we already had cached.
      this.logger.warn(
        `Vercel status refresh failed for ${domain}: ${(err as Error).message}`,
      );
      staleSince = staleSince ?? new Date();
      await this.userProjectModel
        .updateOne(
          { _id: project._id },
          {
            $set: {
              'domainConfig.staleSince': staleSince,
            },
          },
        )
        .exec()
        .catch(() => undefined);
    }

    return {
      domain,
      verified,
      dnsRecords,
      verification,
      misconfigured,
      configuredBy,
      ...(staleSince ? { staleSince: new Date(staleSince).toISOString() } : {}),
    } as CustomDomainStatusDto;
  }

  async addDomain(
    projectId: string,
    domainRaw: string,
    userId: string,
  ): Promise<CustomDomainStatusDto> {
    await this.access.requireOwnerOrAdmin(userId, projectId);
    const project = await this.loadProject(projectId);

    const domain = (domainRaw || '').trim().toLowerCase();
    if (!DOMAIN_REGEX.test(domain)) {
      throw new BadRequestException(
        'Invalid domain format. Example: app.example.com',
      );
    }

    if (project.customDomain && project.customDomain !== domain) {
      throw new BadRequestException(
        `This project already has ${project.customDomain} attached. Remove it first.`,
      );
    }

    // E5 — reserve the domain in Mongo *before* calling Vercel, so the
    // sparse-unique index immediately fails any concurrent add for the
    // same hostname on a different project. This used to be a Vercel-
    // first flow which produced split-brain (Vercel had the domain,
    // Mongo didn't, or two Mongo rows pointed at the same hostname).
    try {
      await this.userProjectModel
        .updateOne(
          { _id: project._id },
          {
            $set: {
              customDomain: domain,
              // optimistic: Vercel hasn't run yet, mark unverified
              domainVerified: false,
              domainConfig: {
                pending: true,
                updatedAt: new Date(),
              },
            },
          },
        )
        .exec();
    } catch (err: unknown) {
      if ((err as { code?: number } | undefined)?.code === 11000) {
        throw new ConflictException(
          `Domain ${domain} is already attached to another project`,
        );
      }
      throw err;
    }

    let vercelRes: Awaited<ReturnType<VercelService['addDomainToProject']>>;
    try {
      vercelRes = await this.vercel.addDomainToProject(
        this.vercelProjectName(projectId),
        domain,
      );
    } catch (err) {
      // Vercel rejected the add — roll back the Mongo reservation so we
      // don't leave a phantom customDomain that no DNS query will ever
      // resolve.
      await this.userProjectModel
        .updateOne(
          { _id: project._id, customDomain: domain },
          {
            $unset: { customDomain: '', domainConfig: '' },
            $set: { domainVerified: false },
          },
        )
        .exec()
        .catch(() => undefined);
      throw new InternalServerErrorException(
        `Failed to add domain to Vercel: ${(err as Error).message}`,
      );
    }

    let misconfigured = false;
    let configuredBy: string | null = null;
    try {
      const cfg = await this.vercel.getDomainConfig(domain);
      misconfigured = Boolean(cfg.misconfigured);
      configuredBy = cfg.configuredBy ?? null;
    } catch (err) {
      this.logger.warn(
        `getDomainConfig failed for ${domain}: ${(err as Error).message}`,
      );
    }

    await this.userProjectModel
      .updateOne(
        { _id: project._id },
        {
          $set: {
            domainVerified: Boolean(vercelRes.verified),
            domainConfig: {
              verification: vercelRes.verification,
              misconfigured,
              configuredBy,
              updatedAt: new Date(),
            },
          },
        },
      )
      .exec();

    return {
      domain,
      verified: Boolean(vercelRes.verified),
      dnsRecords: this.buildDnsRecords(domain),
      verification: vercelRes.verification,
      misconfigured,
      configuredBy,
    };
  }

  async removeDomain(projectId: string, userId: string): Promise<void> {
    await this.access.requireOwnerOrAdmin(userId, projectId);
    const project = await this.loadProject(projectId);

    const domain = project.customDomain;
    if (!domain) {
      return;
    }

    // E5 — try Vercel first. If Vercel still has the domain attached
    // and we cleared Mongo eagerly, the user has no way to retry the
    // removal because they no longer "own" the domain in our model.
    try {
      await this.vercel.removeDomainFromProject(
        this.vercelProjectName(projectId),
        domain,
      );
    } catch (err) {
      const message = (err as Error).message || '';
      const isMissing =
        /not\s+found/i.test(message) ||
        /forbidden/i.test(message) ||
        /404/.test(message);
      if (!isMissing) {
        // Mark for reconcile and surface to the user — don't silently
        // succeed when the upstream removal failed.
        await this.userProjectModel
          .updateOne(
            { _id: project._id, customDomain: domain },
            {
              $set: {
                'domainConfig.pendingRemoval': true,
                'domainConfig.staleSince': new Date(),
              },
            },
          )
          .exec()
          .catch(() => undefined);
        this.logger.error(
          `Vercel removeDomainFromProject failed for ${domain}: ${message}`,
        );
        throw new InternalServerErrorException(
          `Failed to remove domain from Vercel: ${message}`,
        );
      }
      this.logger.warn(
        `Vercel reported domain ${domain} already gone; clearing locally`,
      );
    }

    await this.userProjectModel
      .updateOne(
        { _id: project._id },
        {
          $unset: { customDomain: '', domainConfig: '' },
          $set: { domainVerified: false },
        },
      )
      .exec();
  }

  async verifyDomain(
    projectId: string,
    userId: string,
  ): Promise<CustomDomainStatusDto> {
    const status = await this.getStatus(projectId, userId);
    if (!status) {
      throw new BadRequestException('No custom domain is configured');
    }
    return status;
  }

  /**
   * E5 — periodic reconciliation. Scans for custom-domain rows whose
   * cached state is stale (last refresh failed) or marked
   * `pendingRemoval` (the previous remove call hit a Vercel error)
   * and re-attempts the operation against Vercel. Without this the
   * domain settings panel keeps showing "may be out of date" until
   * the owner manually clicks "Verify DNS" — and orphaned domains in
   * Vercel never get cleaned up.
   *
   * Runs every 30 minutes and walks at most `BATCH_SIZE` rows per tick
   * so a backlog doesn't starve the API process.
   */
  @Cron('*/30 * * * *', { name: 'custom-domain-reconcile' })
  async reconcileStaleDomains(): Promise<void> {
    const BATCH_SIZE = 25;
    type DomainCfg = {
      staleSince?: Date | string;
      pendingRemoval?: boolean;
    };
    const candidates = await this.userProjectModel
      .find({
        customDomain: { $ne: null },
        deletedAt: null,
        $or: [
          { 'domainConfig.staleSince': { $exists: true, $ne: null } },
          { 'domainConfig.pendingRemoval': true },
        ],
      })
      .select('_id customDomain domainConfig')
      .limit(BATCH_SIZE)
      .lean()
      .exec();

    if (candidates.length === 0) return;
    this.logger.log(
      `[domain-reconcile] checking ${candidates.length} stale custom-domain rows`,
    );

    const describeErr = (err: unknown): string =>
      err instanceof Error ? err.message : 'unknown error';

    for (const row of candidates) {
      const id = String(row._id);
      const domain = row.customDomain ?? '';
      const cfg = (row.domainConfig as DomainCfg | undefined) ?? {};
      try {
        if (cfg.pendingRemoval) {
          await this.vercel
            .removeDomainFromProject(this.vercelProjectName(id), domain)
            .catch((err: unknown) => {
              const message = (err as Error)?.message || '';
              const missing =
                /not\s+found/i.test(message) ||
                /forbidden/i.test(message) ||
                /404/.test(message);
              if (!missing) throw err;
            });
          await this.userProjectModel
            .updateOne(
              { _id: row._id },
              {
                $unset: { customDomain: '', domainConfig: '' },
                $set: { domainVerified: false },
              },
            )
            .exec();
          this.logger.log(
            `[domain-reconcile] purged pendingRemoval domain ${domain} for project ${id}`,
          );
          continue;
        }

        const vercelDomain = await this.vercel.verifyProjectDomain(
          this.vercelProjectName(id),
          domain,
        );
        const cfgRes = await this.vercel.getDomainConfig(domain);
        await this.userProjectModel
          .updateOne(
            { _id: row._id },
            {
              $set: {
                domainVerified: Boolean(vercelDomain.verified),
                domainConfig: {
                  verification: vercelDomain.verification,
                  misconfigured: Boolean(cfgRes.misconfigured),
                  configuredBy: cfgRes.configuredBy ?? null,
                  updatedAt: new Date(),
                },
              },
            },
          )
          .exec();
      } catch (err) {
        this.logger.warn(
          `[domain-reconcile] retry failed for project ${id} (${domain}): ${describeErr(err)}`,
        );
      }
    }
  }
}
