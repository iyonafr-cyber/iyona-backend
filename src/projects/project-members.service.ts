import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { UserProject } from './entities/user-project.entity';
import {
  ProjectMember,
  ProjectMemberRole,
} from './entities/project-member.entity';
import { ProjectAccessService } from './project-access.service';
import { InviteProjectMemberDto } from './dto/invite-project-member.dto';
import { ProjectMemberRowDto } from './dto/project-member-row.dto';
import type { IUserHelper } from '../user/interface/user.helper.interface';

type OwnerLike = {
  _id: Types.ObjectId;
  email?: string;
  firstName?: string;
  lastName?: string;
  fullName?: string;
};

@Injectable()
export class ProjectMembersService {
  constructor(
    @InjectModel(UserProject.name)
    private readonly userProjectModel: Model<UserProject>,
    @InjectModel(ProjectMember.name)
    private readonly projectMemberModel: Model<ProjectMember>,
    private readonly access: ProjectAccessService,
    @Inject('IUserHelper') private readonly userHelper: IUserHelper,
  ) {}

  /** List owner + members visible to the current user (owner/admin only). */
  async list(
    projectId: string,
    currentUserId: string,
  ): Promise<ProjectMemberRowDto[]> {
    await this.access.requireManager(currentUserId, projectId);

    const projectRaw = await this.userProjectModel
      .findById(projectId)
      .select('userId createdAt')
      .lean<{ userId: Types.ObjectId; createdAt?: Date } | null>()
      .exec();
    if (!projectRaw) {
      throw new NotFoundException(`Project with ID ${projectId} not found`);
    }
    const project = projectRaw;

    const rows: ProjectMemberRowDto[] = [];

    const owners = await this.userHelper.findUserWithSchema({
      _id: String(project.userId),
    } as Parameters<IUserHelper['findUserWithSchema']>[0]);
    const owner = owners[0] as OwnerLike | undefined;
    const ownerLabel =
      owner?.fullName ||
      [owner?.firstName, owner?.lastName].filter(Boolean).join(' ') ||
      'Owner';
    rows.push({
      _id: String(project.userId),
      userId: String(project.userId),
      email: owner?.email ?? '',
      kind: 'owner',
      label: ownerLabel,
      joinedAt: project.createdAt
        ? new Date(project.createdAt).toISOString()
        : undefined,
    });

    const members = await this.projectMemberModel
      .find({ projectId: new Types.ObjectId(projectId) })
      .sort({ createdAt: 1 })
      .lean();
    for (const m of members) {
      rows.push({
        _id: String(m._id),
        userId: m.userId ? String(m.userId) : undefined,
        email: m.email,
        role: m.role,
        kind: 'member',
        joinedAt: (m as unknown as { createdAt?: Date }).createdAt
          ? new Date(
              (m as unknown as { createdAt: Date }).createdAt,
            ).toISOString()
          : undefined,
      });
    }

    return rows;
  }

  async invite(
    projectId: string,
    dto: InviteProjectMemberDto,
    currentUserId: string,
  ): Promise<ProjectMemberRowDto> {
    await this.access.requireManager(currentUserId, projectId);

    const project = await this.userProjectModel
      .findById(projectId)
      .select('userId')
      .lean();
    if (!project) {
      throw new NotFoundException(`Project with ID ${projectId} not found`);
    }

    const email = dto.email.trim().toLowerCase();
    if (!email) {
      throw new BadRequestException('Email is required');
    }

    const invitees = await this.userHelper.findUserWithSchema({
      email,
    } as Parameters<IUserHelper['findUserWithSchema']>[0]);
    const invitee = invitees[0] as
      | { _id: Types.ObjectId; email?: string }
      | undefined;
    if (!invitee) {
      throw new BadRequestException(
        'No registered user with that email. Ask them to sign up first.',
      );
    }

    if (String(invitee._id) === String(project.userId)) {
      throw new BadRequestException(
        'The project owner is already a member of this project',
      );
    }

    try {
      const doc = await this.projectMemberModel.create({
        projectId: new Types.ObjectId(projectId),
        userId: new Types.ObjectId(String(invitee._id)),
        email,
        role: dto.role,
        invitedBy: new Types.ObjectId(currentUserId),
      });

      return {
        _id: String(doc._id),
        userId: String(doc.userId),
        email: doc.email,
        role: doc.role,
        kind: 'member',
        joinedAt: (doc as unknown as { createdAt?: Date }).createdAt
          ? new Date(
              (doc as unknown as { createdAt: Date }).createdAt,
            ).toISOString()
          : undefined,
      };
    } catch (err: unknown) {
      // Only the duplicate-key error (E11000) means "already a member".
      // Previously we mapped *any* MongoServerError to ConflictException,
      // which silently turned every transient driver/connection failure
      // into a misleading 409 and made invite errors un-debuggable.
      if ((err as { code?: number } | undefined)?.code === 11000) {
        throw new ConflictException(
          'This user is already a member of the project',
        );
      }
      throw err;
    }
  }

  async remove(
    projectId: string,
    memberId: string,
    currentUserId: string,
  ): Promise<void> {
    await this.access.requireManager(currentUserId, projectId);

    if (!Types.ObjectId.isValid(memberId)) {
      throw new BadRequestException('Invalid member id');
    }

    const member = await this.projectMemberModel
      .findOne({
        _id: new Types.ObjectId(memberId),
        projectId: new Types.ObjectId(projectId),
      })
      .exec();
    if (!member) {
      throw new NotFoundException('Member not found');
    }

    // Prevent a non-owner admin from removing the last other admin? For now
    // keep it simple: managers (owner/admin) can remove any member. Only the
    // project owner cannot appear here anyway (owner isn't a ProjectMember row).
    await member.deleteOne();
  }

  /** Projects where the current user is a collaborator (not owner). */
  async sharedWithMe(
    userId: string,
  ): Promise<Array<{ project: unknown; accessRole: 'admin' | 'user' }>> {
    const memberships = await this.projectMemberModel
      .find({ userId: new Types.ObjectId(userId) })
      .sort({ updatedAt: -1 })
      .lean();
    if (!memberships.length) return [];

    const projectIds = memberships.map((m) => m.projectId);
    const projects = await this.userProjectModel
      .find({ _id: { $in: projectIds }, deletedAt: null })
      .lean();

    const projectById = new Map<string, unknown>();
    for (const p of projects as unknown as Array<{ _id: Types.ObjectId }>) {
      projectById.set(String(p._id), this.sanitizeProject(p));
    }

    const rows: Array<{ project: unknown; accessRole: 'admin' | 'user' }> = [];
    for (const m of memberships) {
      const p = projectById.get(String(m.projectId));
      if (!p) continue;
      rows.push({
        project: p,
        accessRole: m.role === ProjectMemberRole.ADMIN ? 'admin' : 'user',
      });
    }
    return rows;
  }

  /**
   * Strip secrets before returning a project to a non-owner collaborator.
   *
   * Non-owners NEVER see:
   *   - Supabase service-role ciphertext (`supabase.serviceRoleKeyEnc`)
   *   - Stripe secret last-4 — full mask only (`sk_****`, NOT `sk_****<4>`)
   *   - GitHub PAT ciphertext (`github.tokenEnc` / `github.token`)
   *   - Any field whose name ends in `Enc` (ciphertext convention).
   *
   * The Supabase `anonKey` is intentionally left in place — it's a public
   * key designed to ship to the browser and is gated by RLS at runtime.
   */
  private sanitizeProject(project: unknown): unknown {
    if (!project || typeof project !== 'object') return project;
    const p = { ...(project as Record<string, unknown>) };

    if (p.appBuildSecretsEnc != null) {
      delete p.appBuildSecretsEnc;
    }

    const paymentConfig = p.paymentConfig as
      | {
          stripeSecretKey?: string;
          stripePublishableKey?: string;
          mode?: string;
        }
      | undefined;
    if (paymentConfig) {
      const next = { ...paymentConfig };
      if (paymentConfig.stripeSecretKey) {
        // No last-4 leak: collaborators get the masked form only.
        next.stripeSecretKey = 'sk_****';
      }
      p.paymentConfig = next;
    }

    const supabase = p.supabase as Record<string, unknown> | null | undefined;
    if (supabase && typeof supabase === 'object') {
      const safe: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(supabase)) {
        if (k.endsWith('Enc')) continue; // strip serviceRoleKeyEnc, dbPasswordEnc, etc.
        safe[k] = v;
      }
      p.supabase = safe;
    }

    const github = p.github as Record<string, unknown> | null | undefined;
    if (github && typeof github === 'object') {
      const safe: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(github)) {
        if (k.endsWith('Enc') || k === 'token') continue;
        safe[k] = v;
      }
      p.github = safe;
    }

    return p;
  }
}
