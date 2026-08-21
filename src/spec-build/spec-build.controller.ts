import {
  Controller,
  Post,
  Get,
  Body,
  Req,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  Logger,
  NotFoundException,
  ForbiddenException,
  HttpException,
  BadRequestException,
} from '@nestjs/common';
import { ApiOperation, ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import type { Request } from 'express';
import { AuthGuard } from '../auth/guards/auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorator/roles.decorator';
import { UserRole } from '../user/roles/roles.enum';
import { AuthedRequest } from '../credits/types/authed-request';
import { UserProject } from '../projects/entities/user-project.entity';
import { SpecBuildJobService } from './spec-build-job.service';
import { RunSpecBuildDto } from './dto/run-spec-build.dto';

function userIdFromRequest(req: Request): {
  userId: string;
  requestId?: string;
} {
  const authed = req as unknown as AuthedRequest;
  const id = authed.fullUser._id;
  const userId =
    typeof id === 'string'
      ? id
      : ((id as { toHexString?: () => string }).toHexString?.() ?? String(id));
  return {
    userId,
    requestId: req.headers['x-request-id'] as string | undefined,
  };
}

@ApiTags('SpecBuild')
@ApiBearerAuth('JWT-auth')
@UseGuards(AuthGuard, RolesGuard)
@Roles(UserRole.USER)
@Controller('spec-build')
export class SpecBuildController {
  private readonly logger = new Logger(SpecBuildController.name);

  constructor(
    private readonly specBuildJobService: SpecBuildJobService,
    @InjectModel(UserProject.name)
    private readonly projectModel: Model<UserProject>,
  ) {}

  @Post('run')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary:
      'Queue spec→Cursor build (brief → seed → Cursor agent → deploy). Poll GET jobs/:jobId.',
  })
  async run(@Body() dto: RunSpecBuildDto, @Req() req: Request) {
    const { userId } = userIdFromRequest(req);

    const project = await this.projectModel.findById(dto.projectId).exec();
    if (!project)
      throw new NotFoundException(`Project ${dto.projectId} not found`);
    if (String(project.userId) !== userId) {
      throw new ForbiddenException('You do not own this project.');
    }

    const blocking = await this.specBuildJobService.findBlockingJobForProject(
      dto.projectId,
    );
    if (blocking) {
      throw new HttpException(
        {
          statusCode: HttpStatus.CONFLICT,
          message: 'spec_build_in_progress',
          jobId: String(blocking._id),
        },
        HttpStatus.CONFLICT,
      );
    }

    const { jobId } = await this.specBuildJobService.createQueuedJob({
      projectId: dto.projectId,
      userId,
      projectIdea: dto.projectIdea,
      answers: dto.answers ?? {},
      questionLabels: dto.questionLabels,
    });

    this.logger.log(
      `[SpecBuild] Queued job ${jobId} for project ${dto.projectId}`,
    );

    return { data: { jobId, status: 'QUEUED' } };
  }

  @Get('jobs/:jobId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Poll a spec→Cursor build job.' })
  async getJob(
    @Param('jobId') jobId: string,
    @Query('projectId') projectId: string,
    @Req() req: Request,
  ) {
    const { userId } = userIdFromRequest(req);
    if (!projectId?.trim()) {
      throw new BadRequestException('projectId query param is required');
    }
    const data = await this.specBuildJobService.getJobForUser(
      jobId,
      userId,
      projectId.trim(),
    );
    return { data };
  }
}
