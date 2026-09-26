import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { User } from '../../user/entities/user.entity';
import {
  ProjectStatus,
  UserProject,
  WorkflowStatus,
} from '../../projects/entities/user-project.entity';
import { Chat } from '../../projects/entities/chat.entity';
import { SpecBuildJob } from '../../spec-build/entities/spec-build-job.entity';
import { AuditActor, AuditLogService } from '../audit/audit-log.service';

export interface AdminProjectListQuery {
  q?: string;
  ownerId?: string;
  status?: string;
  stage?: string;
  deleted?: string;
  page?: number;
  pageSize?: number;
}

export interface AdminProjectPatch {
  takedown?: boolean;
  locked?: boolean;
  name?: string;
  reason?: string;
}

export type AdminProjectListItem = Record<string, unknown> & {
  _id: Types.ObjectId;
};

export interface AdminProjectListResult {
  items: AdminProjectListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AdminProjectDetail {
  project: Record<string, unknown>;
  owner: Record<string, unknown> | null;
  counts: { chats: number };
}

/** One archived build: what the brain wrote, and what the agent was given. */
export interface AdminBuildArtifact {
  id: string;
  status: string | null;
  projectIdea: string | null;
  /** null for builds that ran before archiving shipped. */
  brief: string | null;
  agentPrompt: string | null;
  createdAt: string | null;
}

@Injectable()
export class AdminProjectsService {
  constructor(
    @InjectModel(UserProject.name)
    private readonly projectModel: Model<UserProject>,
    @InjectModel(User.name) private readonly userModel: Model<User>,
    @InjectModel(Chat.name) private readonly chatModel: Model<Chat>,
    @InjectModel(SpecBuildJob.name)
    private readonly specBuildJobModel: Model<SpecBuildJob>,
    private readonly audit: AuditLogService,
  ) {}

  /**
   * The archived build instructions for a project: for each build, the plan the
   * LLM brain wrote and the exact prompt the Cursor agent received.
   *
   * Deliberately its own endpoint rather than part of `detail()`. Each record
   * is tens of KB, and `detail()` is loaded every time an admin opens a
   * project — nobody should pay for this payload unless they asked to read it.
   * `brief` and `agentPrompt` are `select: false` on the schema, so they must
   * be requested explicitly here.
   */
  async buildArtifacts(
    projectId: string,
    limit = 5,
  ): Promise<AdminBuildArtifact[]> {
    if (!Types.ObjectId.isValid(projectId)) {
      throw new NotFoundException('Project not found');
    }
    const jobs = await this.specBuildJobModel
      .find({ projectId: new Types.ObjectId(projectId) })
      .select('+brief +agentPrompt')
      .sort({ createdAt: -1 })
      .limit(Math.min(20, Math.max(1, limit)))
      .lean<
        Array<{
          _id: Types.ObjectId;
          status?: string;
          projectIdea?: string;
          brief?: string;
          agentPrompt?: string;
          createdAt?: Date;
        }>
      >()
      .exec();

    return jobs.map((job) => ({
      id: String(job._id),
      status: job.status ?? null,
      projectIdea: job.projectIdea ?? null,
      // Builds that ran before this feature shipped have no archive; the UI
      // says so rather than rendering an empty box that looks like a bug.
      brief: job.brief ?? null,
      agentPrompt: job.agentPrompt ?? null,
      createdAt: job.createdAt ? job.createdAt.toISOString() : null,
    }));
  }

  async list(query: AdminProjectListQuery): Promise<AdminProjectListResult> {
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 25));

    const match: Record<string, unknown> = {};
    if (query.q) {
      const rx = new RegExp(escapeRegex(query.q.trim()), 'i');
      match.$or = [{ name: rx }, { initialPrompt: rx }];
    }
    if (query.ownerId && Types.ObjectId.isValid(query.ownerId)) {
      match.userId = new Types.ObjectId(query.ownerId);
    }
    if (query.status) match.status = query.status;
    if (query.stage) match.stage = query.stage;
    if (query.deleted === 'true') {
      match.deletedAt = { $ne: null };
    } else if (query.deleted === 'false' || !query.deleted) {
      match.deletedAt = null;
    }

    const [items, total] = await Promise.all([
      this.projectModel
        .aggregate<AdminProjectListItem>([
          { $match: match },
          { $sort: { createdAt: -1 } },
          { $skip: (page - 1) * pageSize },
          { $limit: pageSize },
          {
            $lookup: {
              from: 'users',
              localField: 'userId',
              foreignField: '_id',
              as: 'owner',
            },
          },
          { $unwind: { path: '$owner', preserveNullAndEmptyArrays: true } },
          {
            $project: {
              name: 1,
              initialPrompt: 1,
              status: 1,
              stage: 1,
              stageStatus: 1,
              locked: 1,
              deletedAt: 1,
              previewUrl: 1,
              deployment: 1,
              createdAt: 1,
              updatedAt: 1,
              'owner._id': 1,
              'owner.email': 1,
              'owner.role': 1,
            },
          },
        ])
        .exec(),
      this.projectModel.countDocuments(match).exec(),
    ]);

    return { items, total, page, pageSize };
  }

  async detail(projectId: string): Promise<AdminProjectDetail> {
    if (!Types.ObjectId.isValid(projectId)) {
      throw new NotFoundException('Project not found');
    }
    const project = await this.projectModel
      .findById(projectId)
      .lean<Record<string, unknown> & { userId?: Types.ObjectId | string }>()
      .exec();
    if (!project) throw new NotFoundException('Project not found');

    const ownerId = project.userId;
    const owner = ownerId
      ? await this.userModel
          .findById(ownerId, { email: 1, role: 1, planId: 1 })
          .lean<Record<string, unknown>>()
          .exec()
      : null;
    const chatsCount = await this.chatModel
      .countDocuments({ projectId })
      .exec();

    return { project, owner, counts: { chats: chatsCount } };
  }

  async patch(
    projectId: string,
    dto: AdminProjectPatch,
    actor: AuditActor,
  ): Promise<AdminProjectDetail> {
    if (!Types.ObjectId.isValid(projectId)) {
      throw new NotFoundException('Project not found');
    }
    const existing = await this.projectModel.findById(projectId);
    if (!existing || existing.deletedAt) {
      throw new NotFoundException('Project not found');
    }

    const update: Record<string, unknown> = {};
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};

    if (dto.takedown !== undefined) {
      if (dto.takedown) {
        update['deployment.status'] = WorkflowStatus.FAILED;
        update.locked = true;
        before.takedown = false;
        after.takedown = true;
      } else {
        // Reverting a takedown: unlock, and if the project was previously
        // deployed, restore its deployment status to COMPLETED so the
        // admin UI stops showing "failed" and users can access the app
        // again. Draft/building projects keep their NOT_STARTED default.
        update.locked = false;
        if (existing.status === ProjectStatus.DEPLOYED) {
          update['deployment.status'] = WorkflowStatus.COMPLETED;
        } else {
          update['deployment.status'] = WorkflowStatus.NOT_STARTED;
        }
        before.takedown = true;
        after.takedown = false;
      }
    } else if (dto.locked !== undefined && dto.locked !== existing.locked) {
      update.locked = dto.locked;
      before.locked = existing.locked;
      after.locked = dto.locked;
    }

    if (dto.name !== undefined && dto.name !== existing.name) {
      update.name = dto.name;
      before.name = existing.name ?? null;
      after.name = dto.name;
    }

    if (Object.keys(update).length === 0) {
      return this.detail(projectId);
    }

    await this.projectModel
      .findByIdAndUpdate(projectId, { $set: update })
      .exec();

    const action = dto.takedown === true ? 'project.takedown' : 'project.patch';
    await this.audit.log(actor, {
      action,
      targetType: 'project',
      targetId: projectId,
      before,
      after,
      reason: dto.reason ?? null,
    });

    return this.detail(projectId);
  }

  async softDelete(
    projectId: string,
    reason: string | undefined,
    actor: AuditActor,
  ): Promise<void> {
    if (!Types.ObjectId.isValid(projectId)) {
      throw new NotFoundException('Project not found');
    }
    const existing = await this.projectModel.findById(projectId);
    if (!existing || existing.deletedAt) {
      throw new NotFoundException('Project not found');
    }

    await this.projectModel
      .findByIdAndUpdate(projectId, {
        $set: { deletedAt: new Date(), locked: true },
      })
      .exec();

    await this.audit.log(actor, {
      action: 'project.soft_delete',
      targetType: 'project',
      targetId: projectId,
      before: { deletedAt: null },
      after: { deletedAt: new Date().toISOString() },
      reason: reason ?? null,
    });
  }
}

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
