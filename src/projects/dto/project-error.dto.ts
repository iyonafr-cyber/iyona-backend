import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  ProjectErrorKind,
  ProjectErrorStatus,
} from '../entities/project-error.entity';

/**
 * Body of `POST /projects/:id/errors`. Posted by the workspace SPA
 * after it receives a `iyona:error` or `iyona:console` event from
 * the preview-bridge running inside the deployed app's iframe.
 */
export class LogProjectErrorDto {
  @IsEnum(ProjectErrorKind)
  kind!: ProjectErrorKind;

  @IsString()
  @MaxLength(2000)
  message!: string;

  @IsOptional()
  @IsString()
  @MaxLength(20_000)
  stack?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  source?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  line?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  col?: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  pageUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  userAgent?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  revisionId?: string;
}

export class ProjectErrorDto {
  _id!: string;

  projectId!: string;

  reportedBy?: string | null;

  revisionId?: string;

  kind!: ProjectErrorKind;

  message!: string;

  stack?: string;

  source?: string;

  line?: number;

  col?: number;

  pageUrl?: string;

  userAgent?: string;

  fingerprint!: string;

  occurrences!: number;

  firstSeenAt!: string;

  lastSeenAt!: string;

  status!: ProjectErrorStatus;

  sentToChat!: boolean;
}

export class UpdateProjectErrorDto {
  @IsOptional()
  @IsEnum(ProjectErrorStatus)
  status?: ProjectErrorStatus;

  @IsOptional()
  sentToChat?: boolean;
}
