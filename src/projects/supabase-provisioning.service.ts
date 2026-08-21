import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { UserProject, SupabaseStatus } from './entities/user-project.entity';
import { SupabaseService } from 'src/supabase/supabase.service';
import { DatabaseDetectService } from './database-detect.service';
import type { IEncryptionService } from 'src/encryption/interface/encryption.interface.service';
import {
  isManagedProvisioningEnabled,
  MANAGED_PROVISIONING_DISABLED_MESSAGE,
} from 'src/supabase/managed-provisioning.flag';

/**
 * Managed-Supabase provisioning for a project (DB + auth + storage). Extracted
 * from `ProjectsService` as part of decomposing that god class.
 *
 * All writes to the `supabase` sub-document use dot-notation (never replace the
 * whole object) so a partial/failed run can't wipe url/keys from a prior
 * successful run. Credentials are encrypted at rest via `IEncryptionService`.
 *
 * DORMANT BY DEFAULT (decision 07). Every entry point checks
 * `isManagedProvisioningEnabled()` and returns without doing anything when the
 * flag is off, which it is unless an operator sets
 * `SUPABASE_MANAGED_PROVISIONING=true`. The implementation is deliberately
 * left intact for a future paid hosted-database tier — do not delete it, and
 * do not add a new caller that bypasses the flag check.
 */
@Injectable()
export class SupabaseProvisioningService {
  private readonly logger = new Logger(SupabaseProvisioningService.name);

  constructor(
    @InjectModel(UserProject.name)
    private readonly userProjectModel: Model<UserProject>,
    private readonly supabaseService: SupabaseService,
    private readonly databaseDetectService: DatabaseDetectService,
    @Inject('IEncryptionService')
    private readonly encryptionService: IEncryptionService,
  ) {}

  async startSupabaseProvisioning(
    projectId: string,
    source: 'initial' | 'mid-chat' | 'retry' = 'mid-chat',
  ): Promise<SupabaseStatus> {
    const project = await this.userProjectModel
      .findById(projectId)
      .select('supabase.status')
      .lean();
    if (!project) return 'none';

    if (!isManagedProvisioningEnabled()) {
      // Report the existing status rather than inventing one — a project that
      // was provisioned before the flag flipped is still perfectly usable.
      this.logger.log(
        `Managed provisioning is disabled — ignoring ${source} provision request for ${projectId}`,
      );
      return project.supabase?.status ?? 'none';
    }

    const status = project.supabase?.status;

    // Already ready or already provisioning — report status, start nothing new.
    if (status === 'ready') return 'ready';
    if (status === 'pending' || status === 'provisioning') return status;

    // none / failed / undefined → mark pending, then fire provisioning detached.
    // Dot-notation only — never replace the whole supabase object or we wipe
    // url/keys from a prior partial or successful run.
    await this.userProjectModel
      .updateOne(
        { _id: projectId },
        {
          $set: {
            'supabase.status': 'pending',
            'supabase.provisioningError': null,
          },
        },
      )
      .exec();

    // Detached: do NOT await — provisioning must outlive this request.
    void this.provisionSupabaseAsync(projectId, source);
    return 'pending';
  }

  async ensureSupabaseReady(
    projectId: string,
    source: 'initial' | 'mid-chat' | 'retry' = 'initial',
  ): Promise<boolean> {
    const project = await this.userProjectModel
      .findById(projectId)
      .select('supabase')
      .lean();
    if (!project) return false;

    const status = project.supabase?.status;

    // Already ready — nothing to do
    if (status === 'ready') return true;

    // Flag off: never start a run, and never block the caller waiting for one
    // that will not happen. A BYO project reaches 'ready' through the connect
    // endpoint, not through this path.
    if (!isManagedProvisioningEnabled()) return false;

    // Not yet provisioned — kick it off
    if (!status || status === 'none' || status === 'failed') {
      // Initialize the supabase block if it doesn't exist
      if (!status || status === 'none') {
        await this.userProjectModel
          .updateOne(
            { _id: projectId },
            { $set: { supabase: { status: 'pending' } } },
          )
          .exec();
      }
      await this.provisionSupabaseAsync(projectId, source);
      const final = await this.userProjectModel
        .findById(projectId)
        .select('supabase.status')
        .lean();
      return final?.supabase?.status === 'ready';
    }

    // Pending or provisioning — poll until ready or timeout (3 min)
    const deadline = Date.now() + 3 * 60_000;
    while (Date.now() < deadline) {
      const doc = await this.userProjectModel
        .findById(projectId)
        .select('supabase.status')
        .lean();
      if (doc?.supabase?.status === 'ready') return true;
      if (doc?.supabase?.status === 'failed') return false;
      await new Promise((r) => setTimeout(r, 3000));
    }
    return false;
  }

  /**
   * Provision a Supabase project for the given Jarvis project and persist the
   * encrypted credentials. Runs detached from the HTTP request that triggered
   * it. Errors are captured onto `supabase.provisioningError` for the SPA.
   */
  async provisionSupabaseAsync(
    projectId: string,
    source: 'initial' | 'mid-chat' | 'retry' = 'initial',
  ): Promise<void> {
    if (!isManagedProvisioningEnabled()) {
      await this.markSupabaseFailed(
        projectId,
        MANAGED_PROVISIONING_DISABLED_MESSAGE,
      );
      return;
    }
    try {
      await this.userProjectModel
        .updateOne(
          { _id: projectId, 'supabase.status': { $in: ['pending', 'failed'] } },
          {
            $set: {
              'supabase.status': 'provisioning',
              'supabase.provisioningError': null,
            },
          },
        )
        .exec();

      if (!this.supabaseService.isEnabled()) {
        await this.markSupabaseFailed(
          projectId,
          'Supabase Management API is not configured on this Jarvis instance. Ask the operator to set SUPABASE_MGMT_TOKEN / SUPABASE_ORG_ID.',
        );
        return;
      }

      const provisioned = await this.supabaseService.provisionProject({
        name: `jarvis-${projectId}`,
      });

      const encrypted = this.encryptionService.encrypt(
        provisioned.serviceRoleKey,
      );
      // PR-2.C — encrypt anonKey at rest. We deliberately leave the legacy
      // `anonKey` field empty for new rows so the next reader is forced down
      // the decrypted path.
      const anonEncrypted = this.encryptionService.encrypt(provisioned.anonKey);

      await this.userProjectModel
        .updateOne(
          { _id: projectId },
          {
            $set: {
              supabase: {
                projectRef: provisioned.projectRef,
                url: provisioned.url,
                anonKey: undefined,
                anonKeyEnc: anonEncrypted,
                serviceRoleKeyEnc: encrypted,
                region: provisioned.region,
                status: 'ready',
                readyAt: new Date(),
                provisioningError: null,
              },
            },
          },
        )
        .exec();

      this.logger.log(
        `Supabase project ${provisioned.projectRef} ready for ${projectId} (source: ${source})`,
      );
    } catch (err) {
      const message = err?.message || 'Supabase provisioning failed';
      this.logger.error(
        `Supabase provisioning failed for ${projectId}: ${message}`,
      );
      await this.markSupabaseFailed(projectId, message);
    }
  }

  /**
   * AI-detect whether the initial prompt needs a persistent database and
   * auto-provision Supabase when it does. Runs detached from project creation;
   * failures only log — a missed detection degrades to the mid-chat flow.
   */
  async detectAndProvisionDatabase(
    projectId: string,
    initialPrompt: string,
  ): Promise<void> {
    if (!isManagedProvisioningEnabled()) return;
    try {
      const needsDb =
        await this.databaseDetectService.promptRequiresDatabase(initialPrompt);
      if (!needsDb) return;

      this.logger.log(
        `AI detected database need from initial prompt for project ${projectId} — auto-provisioning Supabase`,
      );

      // Only claim projects that have no supabase block yet — never race a
      // provisioning started by the toggle or a mid-chat flow.
      const claimed = await this.userProjectModel
        .updateOne(
          {
            _id: projectId,
            $or: [
              { supabase: null },
              { supabase: { $exists: false } },
              { 'supabase.status': 'none' },
            ],
          },
          { $set: { supabase: { status: 'pending' } } },
        )
        .exec();
      if (claimed.modifiedCount === 0) return;

      await this.provisionSupabaseAsync(projectId, 'initial');
    } catch (err) {
      this.logger.warn(
        `detectAndProvisionDatabase failed for ${projectId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  private async markSupabaseFailed(
    projectId: string,
    message: string,
  ): Promise<void> {
    try {
      await this.userProjectModel
        .updateOne(
          { _id: projectId },
          {
            $set: {
              'supabase.status': 'failed',
              'supabase.provisioningError': message,
            },
          },
        )
        .exec();
    } catch (err) {
      this.logger.warn(
        `Failed to mark project ${projectId} supabase as failed: ${err.message}`,
      );
    }
  }
}
