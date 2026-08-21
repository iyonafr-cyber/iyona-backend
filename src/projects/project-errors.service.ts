import { createHash } from 'crypto';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import mongoose, { Model } from 'mongoose';
import {
  ProjectError,
  ProjectErrorDocument,
  ProjectErrorKind,
  ProjectErrorStatus,
} from './entities/project-error.entity';
import {
  LogProjectErrorDto,
  ProjectErrorDto,
  UpdateProjectErrorDto,
} from './dto/project-error.dto';

/**
 * Persistence + business logic for runtime errors captured by the
 * preview-bridge (E3). Three responsibilities:
 *
 *   1. **Dedupe**: identical errors fired in a tight loop should not
 *      flood the project's error list. We compute a fingerprint and
 *      `$inc` `occurrences` instead of inserting a fresh row.
 *
 *   2. **List**: the workspace pulls the most recent open errors so
 *      the PreviewPanel can render the "X errors — Send to Iyona"
 *      pill.
 *
 *   3. **Update**: when a user clicks "Send to Iyona" or "Dismiss",
 *      we mark the row so the pill reflects reality.
 *
 * Authorization is enforced upstream (the controller asserts the
 * caller has access to `projectId` via `ProjectAccessService`).
 */
@Injectable()
export class ProjectErrorsService {
  private readonly logger = new Logger(ProjectErrorsService.name);

  constructor(
    @InjectModel(ProjectError.name)
    private readonly errorModel: Model<ProjectErrorDocument>,
  ) {}

  async log(
    projectId: string,
    reportedBy: string | undefined,
    payload: LogProjectErrorDto,
  ): Promise<ProjectErrorDto> {
    const fingerprint = this.fingerprint(payload);
    const projectObjectId = new mongoose.Types.ObjectId(projectId);
    const reporterObjectId = reportedBy
      ? new mongoose.Types.ObjectId(reportedBy)
      : null;

    const now = new Date();
    const updated = await this.errorModel.findOneAndUpdate(
      { projectId: projectObjectId, fingerprint },
      {
        $setOnInsert: {
          projectId: projectObjectId,
          fingerprint,
          kind: payload.kind,
          firstSeenAt: now,
          status: ProjectErrorStatus.OPEN,
          sentToChat: false,
        },
        $set: {
          // Keep the freshest copy of mutable context. Stack/source
          // can shift between deploys; we want the latest occurrence.
          message: payload.message,
          stack: payload.stack,
          source: payload.source,
          line: payload.line,
          col: payload.col,
          pageUrl: payload.pageUrl,
          userAgent: payload.userAgent,
          revisionId: payload.revisionId,
          reportedBy: reporterObjectId,
          lastSeenAt: now,
        },
        $inc: { occurrences: 1 },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    );

    return this.toDto(updated);
  }

  async list(
    projectId: string,
    opts: { status?: ProjectErrorStatus; limit?: number } = {},
  ): Promise<ProjectErrorDto[]> {
    const filter: Record<string, unknown> = {
      projectId: new mongoose.Types.ObjectId(projectId),
    };
    if (opts.status) filter.status = opts.status;

    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
    const docs = await this.errorModel
      .find(filter)
      .sort({ lastSeenAt: -1 })
      .limit(limit)
      .lean()
      .exec();

    return docs.map((d) => this.toDto(d));
  }

  async patch(
    projectId: string,
    errorId: string,
    patch: UpdateProjectErrorDto,
  ): Promise<ProjectErrorDto> {
    if (!mongoose.Types.ObjectId.isValid(errorId)) {
      throw new NotFoundException('Error not found');
    }
    const updated = await this.errorModel.findOneAndUpdate(
      {
        _id: new mongoose.Types.ObjectId(errorId),
        projectId: new mongoose.Types.ObjectId(projectId),
      },
      { $set: patch },
      { new: true },
    );
    if (!updated) throw new NotFoundException('Error not found');
    return this.toDto(updated);
  }

  /** Wipe all stored errors for a project — used on hard delete. */
  async deleteAllForProject(projectId: string): Promise<number> {
    const res = await this.errorModel.deleteMany({
      projectId: new mongoose.Types.ObjectId(projectId),
    });
    return res.deletedCount ?? 0;
  }

  /**
   * Build a short, stable fingerprint so duplicate errors fold into a
   * single row. We hash the kind, the trimmed message and (when
   * available) the first stack frame so noise like timestamps or
   * dynamic IDs in the message body don't fragment the group.
   */
  private fingerprint(payload: LogProjectErrorDto): string {
    const firstFrame =
      (payload.stack ?? '').split('\n').find((l) => l.trim().length > 0) ?? '';
    const seed = [
      payload.kind,
      payload.message?.trim().slice(0, 500),
      firstFrame.trim().slice(0, 300),
      payload.source ?? '',
    ].join('|');
    return createHash('sha1').update(seed).digest('hex').slice(0, 16);
  }

  private toDto(
    doc: ProjectError | ProjectErrorDocument | Record<string, unknown>,
  ): ProjectErrorDto {
    const d = doc as ProjectErrorDocument & { _id: mongoose.Types.ObjectId };
    return {
      _id: String(d._id),
      projectId: String(d.projectId),
      reportedBy: d.reportedBy ? String(d.reportedBy) : null,
      revisionId: d.revisionId,
      kind: d.kind,
      message: d.message,
      stack: d.stack,
      source: d.source,
      line: d.line,
      col: d.col,
      pageUrl: d.pageUrl,
      userAgent: d.userAgent,
      fingerprint: d.fingerprint,
      occurrences: d.occurrences,
      firstSeenAt:
        d.firstSeenAt instanceof Date
          ? d.firstSeenAt.toISOString()
          : String(d.firstSeenAt),
      lastSeenAt:
        d.lastSeenAt instanceof Date
          ? d.lastSeenAt.toISOString()
          : String(d.lastSeenAt),
      status: d.status,
      sentToChat: d.sentToChat,
    };
  }
}

export { ProjectErrorKind, ProjectErrorStatus };
