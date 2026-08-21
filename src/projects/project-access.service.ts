import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { HydratedDocument, Model, Types } from 'mongoose';
import { UserProject } from './entities/user-project.entity';
import {
  ProjectMember,
  ProjectMemberRole,
} from './entities/project-member.entity';

export type ProjectAccessRole = 'owner' | 'admin' | 'user';

@Injectable()
export class ProjectAccessService {
  constructor(
    @InjectModel(UserProject.name)
    private readonly userProjectModel: Model<UserProject>,
    @InjectModel(ProjectMember.name)
    private readonly projectMemberModel: Model<ProjectMember>,
  ) {}

  async getAccessRole(
    userId: string,
    projectId: string,
  ): Promise<ProjectAccessRole | null> {
    const project = await this.userProjectModel.findById(projectId).exec();
    if (!project || project.deletedAt) {
      return null;
    }
    if (String(project.userId) === userId) {
      return 'owner';
    }
    const member = await this.projectMemberModel
      .findOne({
        projectId: new Types.ObjectId(projectId),
        userId: new Types.ObjectId(userId),
      })
      .exec();
    if (!member) {
      return null;
    }
    return member.role === ProjectMemberRole.ADMIN ? 'admin' : 'user';
  }

  async requireViewer(
    userId: string,
    projectId: string,
  ): Promise<ProjectAccessRole> {
    const role = await this.getAccessRole(userId, projectId);
    if (!role) {
      throw new ForbiddenException('You do not have access to this project');
    }
    return role;
  }

  /**
   * Allow owner OR project admin collaborator. The previous name
   * `requireEditor` implied a "viewer" role existed and editors were a
   * subset of viewers — neither was true. We have three roles:
   *
   *   owner   – the userId on UserProject (full access incl. settings)
   *   admin   – ProjectMember.role = 'admin' (chat + patch + edit)
   *   user    – ProjectMember.role = 'user' (read-only collaborator)
   *
   * Use this guard for every action that mutates project state (patch,
   * snapshot, chat, error, deploy). Owner-only actions (delete, change
   * payment config, transfer ownership) MUST use `requireOwner`.
   */
  async requireOwnerOrAdmin(userId: string, projectId: string): Promise<void> {
    const role = await this.requireViewer(userId, projectId);
    if (role === 'user') {
      throw new ForbiddenException(
        'This action requires admin access to the project',
      );
    }
  }

  /** Invite / manage members: owner or project admin collaborator. */
  async requireManager(userId: string, projectId: string): Promise<void> {
    await this.requireOwnerOrAdmin(userId, projectId);
  }

  async requireOwner(userId: string, projectId: string): Promise<void> {
    const project = await this.userProjectModel.findById(projectId).exec();
    if (!project || project.deletedAt) {
      throw new NotFoundException(`Project with ID ${projectId} not found`);
    }
    if (String(project.userId) !== userId) {
      throw new ForbiddenException(
        'Only the project owner can perform this action',
      );
    }
  }

  /**
   * Load a project by id and confirm the caller owns it, returning the hydrated
   * document. Shared owner-gate for every service that mutates project state —
   * callers that need the doc use the return value, callers that only need the
   * ownership check can ignore it. (404 on an invalid/missing id so we never
   * leak existence.)
   */
  async requireOwnedProject(
    userId: string,
    projectId: string,
  ): Promise<HydratedDocument<UserProject>> {
    if (!Types.ObjectId.isValid(projectId)) {
      throw new NotFoundException(`Project with ID ${projectId} not found`);
    }
    const project = await this.userProjectModel.findById(projectId).exec();
    if (!project || project.deletedAt) {
      throw new NotFoundException(`Project with ID ${projectId} not found`);
    }
    if (String(project.userId) !== String(userId)) {
      throw new ForbiddenException('You do not have access to this project');
    }
    return project;
  }
}
