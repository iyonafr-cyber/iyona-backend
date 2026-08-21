import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { UserProject } from './entities/user-project.entity';
import { ProjectAccessService } from './project-access.service';
import { PatchService } from '../patch/patch.service';
import { DistributedLockService } from '../common/distributed-lock/distributed-lock.service';
import { ExtractSchemaDto } from './dto/patch.dto';
import { logAndThrowError } from 'src/utils/error.utils';

/**
 * Thin authorization + serialization layer in front of the component-schema
 * patch engine (`PatchService`). Extracted from `ProjectsService` as part of
 * decomposing that god class.
 *
 * Every mutating method serializes on the SAME per-project lock key
 * (`project-fsm:<id>`) that `ProjectsService`'s workflow methods use, so a
 * schema extract / rollback can never race a stage transition or another
 * write path on the same project — including across replicas.
 */
@Injectable()
export class ProjectPatchService {
  constructor(
    @InjectModel(UserProject.name)
    private readonly userProjectModel: Model<UserProject>,
    private readonly accessService: ProjectAccessService,
    @Inject(forwardRef(() => PatchService))
    private readonly patchService: PatchService,
    private readonly lock: DistributedLockService,
  ) {}

  /** Serialize project-state mutations under the shared per-project lock. */
  private runProjectExclusive<T>(
    projectId: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    return this.lock.runExclusive(`project-fsm:${projectId}`, fn, {
      waitMs: 30_000,
    });
  }

  /** Cheap read of a project's persisted default model id (router fallback). */
  private async getProjectDefaultModelId(
    projectId: string,
  ): Promise<string | undefined> {
    const project = await this.userProjectModel
      .findOne({ _id: projectId, deletedAt: null })
      .select('defaultModelId')
      .lean();
    return project?.defaultModelId ?? undefined;
  }

  async extractSchema(
    projectId: string,
    userId: string,
    schemaDto: ExtractSchemaDto,
  ) {
    // Schema extraction reads + writes the project's component registry,
    // so it has to share the same mutex bucket as applyPatch /
    // applySimpleUpdate. Without this an extract racing with a patch
    // can persist a schema row that points at a file the patch is in
    // the middle of rewriting.
    return this.runProjectExclusive(projectId, async () => {
      try {
        await this.accessService.requireOwnerOrAdmin(userId, projectId);
        const projectDefaultModelId =
          await this.getProjectDefaultModelId(projectId);
        const { schemas, meta } =
          await this.patchService.extractComponentSchema(
            projectId,
            schemaDto.files,
            schemaDto.executionPlan,
            { userId, modelId: schemaDto.modelId, projectDefaultModelId },
          );
        return { schemas, meta };
      } catch (error) {
        if (
          error instanceof NotFoundException ||
          error instanceof ForbiddenException
        ) {
          throw error;
        }
        throw logAndThrowError('error in extractSchema', error);
      }
    });
  }

  async getComponents(projectId: string, userId: string) {
    try {
      await this.accessService.requireViewer(userId, projectId);
      return await this.patchService.getComponentsByProject(projectId);
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof ForbiddenException
      ) {
        throw error;
      }
      throw logAndThrowError('error in getComponents', error);
    }
  }

  async getComponentVersions(
    projectId: string,
    userId: string,
    componentId: string,
  ) {
    try {
      await this.accessService.requireViewer(userId, projectId);
      return await this.patchService.getComponentVersions(
        projectId,
        componentId,
      );
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof ForbiddenException
      ) {
        throw error;
      }
      throw logAndThrowError('error in getComponentVersions', error);
    }
  }

  async rollbackComponent(
    projectId: string,
    userId: string,
    componentId: string,
    version: string | number,
  ) {
    // Rollback rewrites files and bumps the snapshot version, so it
    // has to serialize with applyPatch / applySimpleUpdate /
    // rollbackProject on the same projectId.
    return this.runProjectExclusive(projectId, async () => {
      try {
        await this.accessService.requireOwnerOrAdmin(userId, projectId);
        const parsedVersion =
          typeof version === 'number' ? version : Number(version);
        if (!Number.isFinite(parsedVersion)) {
          throw new BadRequestException('Invalid version number');
        }
        return await this.patchService.rollbackComponent(
          projectId,
          componentId,
          parsedVersion,
        );
      } catch (error) {
        if (
          error instanceof NotFoundException ||
          error instanceof ForbiddenException ||
          error instanceof BadRequestException
        ) {
          throw error;
        }
        throw logAndThrowError('error in rollbackComponent', error);
      }
    });
  }

  async getSnapshots(projectId: string, userId: string) {
    try {
      await this.accessService.requireViewer(userId, projectId);
      return await this.patchService.getSnapshots(projectId);
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof ForbiddenException
      ) {
        throw error;
      }
      throw logAndThrowError('error in getSnapshots', error);
    }
  }

  async rollbackProject(projectId: string, userId: string, version: number) {
    // Project-wide rollback rewrites the entire revision tree; serialize
    // with every other write path on this project.
    return this.runProjectExclusive(projectId, async () => {
      try {
        await this.accessService.requireOwnerOrAdmin(userId, projectId);
        const parsedVersion =
          typeof version === 'number' ? version : Number(version);
        if (!Number.isFinite(parsedVersion)) {
          throw new BadRequestException('Invalid snapshot version');
        }
        return await this.patchService.rollbackProject(
          projectId,
          parsedVersion,
        );
      } catch (error) {
        if (
          error instanceof NotFoundException ||
          error instanceof ForbiddenException ||
          error instanceof BadRequestException
        ) {
          throw error;
        }
        throw logAndThrowError('error in rollbackProject', error);
      }
    });
  }

  /**
   * E2 — collaborator-scoped per-file diff between a snapshot and current state.
   */
  async diffSnapshot(projectId: string, userId: string, version: number) {
    try {
      await this.accessService.requireViewer(userId, projectId);
      const parsedVersion =
        typeof version === 'number' ? version : Number(version);
      if (!Number.isFinite(parsedVersion)) {
        throw new BadRequestException('Invalid snapshot version');
      }
      return await this.patchService.diffSnapshotAgainstCurrent(
        projectId,
        parsedVersion,
      );
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof ForbiddenException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }
      throw logAndThrowError('error in diffSnapshot', error);
    }
  }

  /**
   * E2 — owner/admin partial revert of a subset of files to a snapshot.
   */
  async revertSnapshotFiles(
    projectId: string,
    userId: string,
    version: number,
    filePaths: string[],
  ) {
    // Partial revert overwrites a subset of files in the latest
    // revision; same race surface as rollbackProject so it must share
    // the projectId mutex.
    return this.runProjectExclusive(projectId, async () => {
      try {
        await this.accessService.requireOwnerOrAdmin(userId, projectId);
        const parsedVersion =
          typeof version === 'number' ? version : Number(version);
        if (!Number.isFinite(parsedVersion)) {
          throw new BadRequestException('Invalid snapshot version');
        }
        if (!Array.isArray(filePaths) || filePaths.length === 0) {
          throw new BadRequestException(
            'filePaths must be a non-empty string array',
          );
        }
        return await this.patchService.revertFilesToSnapshot(
          projectId,
          parsedVersion,
          filePaths,
        );
      } catch (error) {
        if (
          error instanceof NotFoundException ||
          error instanceof ForbiddenException ||
          error instanceof BadRequestException
        ) {
          throw error;
        }
        throw logAndThrowError('error in revertSnapshotFiles', error);
      }
    });
  }
}
