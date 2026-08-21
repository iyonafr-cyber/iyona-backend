import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { plainToInstance } from 'class-transformer';
import { UserProject } from './entities/user-project.entity';
import { User } from 'src/user/entities/user.entity';
import { UserProjectDto } from './dto/user-project-dto.dto';
import {
  PublicProjectDto,
  RemixProjectDto,
  SetPublicProjectDto,
} from './dto/public-project.dto';
import { ProjectAccessService } from './project-access.service';
import { ProjectMapperService } from './project-mapper.service';
import { secureRandomSlug } from 'src/common/secure-random';
import { logAndThrowError } from 'src/utils/error.utils';

/**
 * E5 — public projects, remix, and the template gallery. Extracted from
 * `ProjectsService` as part of decomposing that god class.
 *
 * The unauthenticated read paths (`getPublicProjectBySlug`, template listings)
 * return a redacted `PublicProjectDto` that NEVER carries Supabase keys,
 * payment keys, or the owner's full email — only the local-part of the email is
 * exposed as a display name.
 */
@Injectable()
export class PublicProjectsService {
  private readonly logger = new Logger(PublicProjectsService.name);

  constructor(
    @InjectModel(UserProject.name)
    private readonly userProjectModel: Model<UserProject>,
    @InjectModel(User.name)
    private readonly userModel: Model<User>,
    private readonly accessService: ProjectAccessService,
    private readonly mapper: ProjectMapperService,
  ) {}

  private slugify(input: string): string {
    return (
      (input || 'project')
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 50) || 'project'
    );
  }

  private randomSuffix(): string {
    // CSPRNG-backed so anonymous users can't enumerate or pre-claim
    // public project slugs by guessing the next sequential suffix.
    return secureRandomSlug(5).toLowerCase();
  }

  private async generateUniqueSlug(seed: string): Promise<string> {
    const base = this.slugify(seed);
    for (let i = 0; i < 5; i++) {
      const candidate = `${base}-${this.randomSuffix()}`;
      const clash = await this.userProjectModel
        .exists({ publicSlug: candidate })
        .exec();
      if (!clash) return candidate;
    }
    throw new BadRequestException(
      'Unable to allocate a unique public slug; try again.',
    );
  }

  /**
   * Toggle a project's public visibility. Owner-only. Allocates a permanent
   * slug on the first publish and re-uses it forever after, so links the user
   * shared do not break when they unpublish/republish.
   */
  async setPublicVisibility(
    projectId: string,
    userId: string,
    dto: SetPublicProjectDto,
  ): Promise<UserProjectDto> {
    try {
      const project = await this.accessService.requireOwnedProject(
        userId,
        projectId,
      );
      const update: Record<string, any> = {
        isPublic: dto.isPublic,
      };
      if (dto.publicSummary !== undefined) {
        update.publicSummary = dto.publicSummary;
      }
      // Force a non-empty publicSummary at publish time so we never fall
      // back to the (potentially sensitive) initialPrompt on the
      // unauthenticated /public/* endpoints. Unpublishing has no such
      // requirement.
      if (dto.isPublic) {
        const finalSummary = (
          dto.publicSummary ??
          project.publicSummary ??
          ''
        ).trim();
        if (!finalSummary) {
          throw new BadRequestException(
            'publicSummary is required before publishing a project. Add a short description on the share dialog.',
          );
        }
      }
      if (dto.isPublic && !project.publicSlug) {
        update.publicSlug = await this.generateUniqueSlug(
          project.name || project.initialPrompt || 'project',
        );
      }
      const updated = await this.userProjectModel
        .findByIdAndUpdate(projectId, { $set: update }, { new: true })
        .exec();
      if (!updated) {
        throw new NotFoundException(`Project with ID ${projectId} not found`);
      }
      return this.mapper.toProjectDto(updated);
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof ForbiddenException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }
      throw logAndThrowError('error in setPublicVisibility', error);
    }
  }

  /**
   * Public read of a project by its slug. Returns a redacted `PublicProjectDto`.
   * Throws 404 if the project is unpublished, soft-deleted, or the slug doesn't
   * exist. NEVER returns Supabase keys, payment keys, or owner email.
   */
  async getPublicProjectBySlug(slug: string): Promise<PublicProjectDto> {
    try {
      const project = await this.userProjectModel
        .findOne({ publicSlug: slug, isPublic: true, deletedAt: null })
        .lean()
        .exec();
      if (!project) {
        throw new NotFoundException(`Public project ${slug} not found`);
      }

      let ownerDisplayName = 'Anonymous';
      if (project.userId) {
        const owner = await this.userModel
          .findById(project.userId)
          .select({ email: 1 })
          .lean()
          .exec();
        if (owner?.email) {
          // We never publish the full email — just the local-part.
          ownerDisplayName = String(owner.email).split('@')[0];
        }
      }

      return plainToInstance(PublicProjectDto, {
        _id: String(project._id),
        name: project.name,
        publicSlug: project.publicSlug,
        publicSummary: project.publicSummary || '',
        previewUrl:
          project.deployment?.previewUrl ?? project.previewUrl ?? undefined,
        isTemplate: Boolean(project.isTemplate),
        templateCategory: project.templateCategory,
        remixCount: project.remixCount ?? 0,
        ownerDisplayName,
        createdAt: (project as any).createdAt,
      });
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      throw logAndThrowError('error in getPublicProjectBySlug', error);
    }
  }

  /**
   * Templates gallery listing. Curated by admins via the `isTemplate=true` flag
   * on a project. Optionally filter by `category`.
   */
  async listPublicTemplates(category?: string): Promise<PublicProjectDto[]> {
    try {
      const query: Record<string, any> = {
        isTemplate: true,
        isPublic: true,
        deletedAt: null,
      };
      if (category) query.templateCategory = category;
      const docs = await this.userProjectModel
        .find(query)
        .sort({ remixCount: -1, createdAt: -1 })
        .limit(60)
        .lean()
        .exec();

      return docs.map((p) =>
        plainToInstance(PublicProjectDto, {
          _id: String(p._id),
          name: p.name,
          publicSlug: p.publicSlug,
          publicSummary: p.publicSummary || '',
          previewUrl: p.deployment?.previewUrl ?? p.previewUrl ?? undefined,
          isTemplate: true,
          templateCategory: p.templateCategory,
          remixCount: p.remixCount ?? 0,
          ownerDisplayName: 'Iyona',
          createdAt: (p as any).createdAt,
        }),
      );
    } catch (error) {
      throw logAndThrowError('error in listPublicTemplates', error);
    }
  }

  /**
   * Distinct `templateCategory` values currently in use, so the gallery filter
   * chips can render without a separate config table.
   */
  async listTemplateCategories(): Promise<string[]> {
    try {
      const cats = await this.userProjectModel
        .distinct('templateCategory', {
          isTemplate: true,
          isPublic: true,
          deletedAt: null,
        })
        .exec();
      return cats.filter(Boolean).sort();
    } catch (error) {
      throw logAndThrowError('error in listTemplateCategories', error);
    }
  }

  /**
   * Remix a public/template project. Creates a new project owned by the caller,
   * with `remixOf` set to the source. We DON'T copy generated files — the caller
   * runs the regular questionnaire/execution-plan/generate flow seeded with the
   * source prompt. This keeps credit accounting clean and avoids leaking
   * Supabase / payment keys from the source project.
   */
  async remixProject(
    sourceId: string,
    userId: string,
    dto: RemixProjectDto,
  ): Promise<UserProjectDto> {
    try {
      if (!Types.ObjectId.isValid(sourceId)) {
        throw new NotFoundException(`Project ${sourceId} not found`);
      }
      // Remix is gated strictly on `isPublic: true`. Templates that got marked
      // `isTemplate: true` without being published would previously slip
      // through the OR clause and leak their content to anyone who knew the id.
      const source = await this.userProjectModel
        .findOne({
          _id: sourceId,
          deletedAt: null,
          isPublic: true,
        })
        .lean()
        .exec();
      if (!source) {
        throw new NotFoundException(
          `Public project ${sourceId} not found or not published`,
        );
      }

      const newProject = await this.userProjectModel.create({
        userId,
        name: dto.name || (source.name ? `${source.name} (remix)` : undefined),
        initialPrompt: (dto.initialPrompt || source.initialPrompt || '').trim(),
        remixOf: source._id,
      });

      // Best-effort increment of the source's remixCount. Failures here must
      // not break the user's create flow.
      try {
        await this.userProjectModel
          .updateOne({ _id: source._id }, { $inc: { remixCount: 1 } })
          .exec();
      } catch (err) {
        this.logger.warn(
          `Could not increment remixCount on ${source._id}: ${err.message}`,
        );
      }

      return this.mapper.toProjectDto(newProject);
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      throw logAndThrowError('error in remixProject', error);
    }
  }
}
