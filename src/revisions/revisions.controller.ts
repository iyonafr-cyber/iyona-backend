import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  UseGuards,
  Query,
  Logger,
  BadRequestException,
  HttpCode,
  HttpStatus,
  HttpException,
} from '@nestjs/common';
import { RevisionsService } from './revisions.service';
import { AuthGuard } from 'src/auth/guards/auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorator/roles.decorator';
import { UserRole } from 'src/user/roles/roles.enum';
import { CreateRevisionDto } from './dto/create-revision.dto';
import { RevisionDto } from './dto/revision.dto';
import {
  DeployPreviewDto,
  DeployPreviewResponseDto,
} from './dto/deploy-preview.dto';
import { ProjectsService } from '../projects/projects.service';
import {
  CurrentUser,
  CurrentUserPayload,
} from '../auth/decorator/current-user.decorator';

@UseGuards(AuthGuard, RolesGuard)
@Roles(UserRole.USER)
@Controller('projects/:projectId/revisions')
export class RevisionsController {
  private readonly logger = new Logger(RevisionsController.name);

  constructor(
    private readonly revisionsService: RevisionsService,
    private readonly projectsService: ProjectsService,
  ) {}

  @Post()
  async createRevision(
    @Param('projectId') projectId: string,
    @Body() createRevisionDto: CreateRevisionDto,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ data: RevisionDto }> {
    await this.projectsService.assertProjectOwner(projectId, user.userId);
    const revision = await this.revisionsService.createRevision(
      projectId,
      createRevisionDto,
    );
    return { data: revision };
  }

  @Post('deploy')
  @HttpCode(HttpStatus.ACCEPTED)
  async createAndDeploy(
    @Param('projectId') projectId: string,
    @Body() createRevisionDto: CreateRevisionDto,
    @CurrentUser() user: CurrentUserPayload,
    @Query('framework') framework?: string,
  ): Promise<{ data: DeployPreviewResponseDto }> {
    try {
      await this.projectsService.assertProjectOwner(projectId, user.userId);
      // Log incoming request for debugging
      this.logger.log(
        `Deploy request for project ${projectId}: ${Object.keys(createRevisionDto.files || {}).length} files, framework: ${framework || 'vite'}`,
      );

      // Validate files object
      if (
        !createRevisionDto.files ||
        typeof createRevisionDto.files !== 'object'
      ) {
        this.logger.error(
          `Invalid files object: ${JSON.stringify(createRevisionDto.files)}`,
        );
        throw new BadRequestException('files must be an object');
      }

      // Check if files object is empty
      const fileKeys = Object.keys(createRevisionDto.files);
      if (fileKeys.length === 0) {
        this.logger.error('Files object is empty');
        throw new BadRequestException('files object cannot be empty');
      }

      // Validate that all values are strings
      const nonStringValues = fileKeys.filter(
        (key) => typeof createRevisionDto.files[key] !== 'string',
      );
      if (nonStringValues.length > 0) {
        this.logger.error(
          `Found ${nonStringValues.length} non-string values in files: ${nonStringValues.slice(0, 5).join(', ')}`,
        );
        throw new BadRequestException(
          `files must contain only string values. Found non-string values for: ${nonStringValues.slice(0, 5).join(', ')}`,
        );
      }

      const result = await this.revisionsService.createAndDeploy(
        projectId,
        createRevisionDto,
        framework || 'vite',
      );
      return { data: result };
    } catch (error) {
      this.logger.error(
        `Error in createAndDeploy for project ${projectId}: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  @Get()
  async getRevisions(
    @Param('projectId') projectId: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ data: RevisionDto[] }> {
    await this.projectsService.requireProjectViewer(projectId, user.userId);
    const revisions =
      await this.revisionsService.getRevisionsByProject(projectId);
    return { data: revisions };
  }

  @Get('latest')
  async getLatestRevision(
    @Param('projectId') projectId: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ data: RevisionDto | null }> {
    await this.projectsService.requireProjectViewer(projectId, user.userId);
    const revision = await this.revisionsService.getLatestRevision(projectId);
    return { data: revision };
  }

  @Get('latest/files')
  async getLatestRevisionFiles(
    @Param('projectId') projectId: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ data: Record<string, string> | null }> {
    try {
      await this.projectsService.requireProjectViewer(projectId, user.userId);
      const files =
        await this.revisionsService.getLatestRevisionFiles(projectId);
      return { data: files };
    } catch (error) {
      // Log error for debugging
      this.logger.error(
        `Error getting latest revision files for project ${projectId}: ${error.message}`,
        error.stack,
      );
      // Return null data instead of throwing to allow frontend to handle gracefully
      return { data: null };
    }
  }

  @Get('latest/full-source')
  async getLatestRevisionFullSource(
    @Param('projectId') projectId: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ data: Record<string, string> | null }> {
    try {
      await this.projectsService.requireProjectViewer(projectId, user.userId);
      const files =
        await this.revisionsService.getLatestRevisionFullSource(projectId);
      return { data: files };
    } catch (error) {
      this.logger.error(
        `Error getting full source for project ${projectId}: ${error.message}`,
        error.stack,
      );
      return { data: null };
    }
  }

  @Get('preview')
  async getPreviewUrl(
    @Param('projectId') projectId: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ data: { previewUrl: string | null } }> {
    await this.projectsService.requireProjectViewer(projectId, user.userId);
    try {
      const previewUrl = await this.revisionsService.getPreviewUrl(projectId);
      return { data: { previewUrl } };
    } catch (err) {
      if (err instanceof HttpException) {
        throw err;
      }
      this.logger.error(
        `getPreviewUrl failed for project ${projectId}: ${err instanceof Error ? err.message : String(err)}`,
        err instanceof Error ? err.stack : undefined,
      );
      return { data: { previewUrl: null } };
    }
  }

  @Get('deployments/current')
  async getCurrentDeployment(
    @Param('projectId') projectId: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ data: DeployPreviewResponseDto | null }> {
    await this.projectsService.requireProjectViewer(projectId, user.userId);
    const result =
      await this.revisionsService.getCurrentDeploymentProgress(projectId);
    return { data: result };
  }

  @Get('deployments/:deploymentId/status')
  async getDeploymentStatus(
    @Param('projectId') projectId: string,
    @Param('deploymentId') deploymentId: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ data: DeployPreviewResponseDto }> {
    await this.projectsService.requireProjectViewer(projectId, user.userId);
    const result = await this.revisionsService.getDeploymentProgress(
      projectId,
      deploymentId,
    );
    return { data: result };
  }

  @Get(':revisionId')
  async getRevision(
    @Param('projectId') projectId: string,
    @Param('revisionId') revisionId: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ data: RevisionDto }> {
    await this.projectsService.requireProjectViewer(projectId, user.userId);
    const revision = await this.revisionsService.getRevision(
      projectId,
      revisionId,
    );
    return { data: revision };
  }

  @Get(':revisionId/files')
  async getRevisionFiles(
    @Param('projectId') projectId: string,
    @Param('revisionId') revisionId: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ data: Record<string, string> }> {
    await this.projectsService.requireProjectViewer(projectId, user.userId);
    const files = await this.revisionsService.getRevisionFiles(
      projectId,
      revisionId,
    );
    return { data: files };
  }

  @Post(':revisionId/deploy-preview')
  @HttpCode(HttpStatus.ACCEPTED)
  async deployPreview(
    @Param('projectId') projectId: string,
    @Param('revisionId') revisionId: string,
    @Body() deployPreviewDto: DeployPreviewDto,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ data: DeployPreviewResponseDto }> {
    await this.projectsService.assertProjectOwner(projectId, user.userId);
    const result = await this.revisionsService.deployPreview(
      projectId,
      revisionId,
      deployPreviewDto.framework || 'vite',
    );
    return { data: result };
  }

  /**
   * Roll back the live site to a previous revision by redeploying its pinned
   * commit as a new revision (forward-only, non-destructive). Owner-only.
   */
  @Post(':revisionId/rollback')
  @HttpCode(HttpStatus.ACCEPTED)
  async rollback(
    @Param('projectId') projectId: string,
    @Param('revisionId') revisionId: string,
    @Body() deployPreviewDto: DeployPreviewDto,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ data: DeployPreviewResponseDto }> {
    await this.projectsService.assertProjectOwner(projectId, user.userId);
    const result = await this.revisionsService.rollbackToRevision(
      projectId,
      revisionId,
      deployPreviewDto.framework || 'vite',
    );
    return { data: result };
  }
}
