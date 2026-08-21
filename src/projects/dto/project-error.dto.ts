import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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
 * after it receives a `jarvis:error` or `jarvis:console` event from
 * the preview-bridge running inside the deployed app's iframe.
 */
export class LogProjectErrorDto {
  @ApiProperty({ enum: ProjectErrorKind })
  @IsEnum(ProjectErrorKind)
  kind!: ProjectErrorKind;

  @ApiProperty({ description: 'Top-level error message.' })
  @IsString()
  @MaxLength(2000)
  message!: string;

  @ApiPropertyOptional({
    description: 'Full stack trace, truncated server-side.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(20_000)
  stack?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  source?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  line?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  col?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  pageUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  userAgent?: string;

  @ApiPropertyOptional({
    description: 'Optional revision/deployment id for correlation.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  revisionId?: string;
}

export class ProjectErrorDto {
  @ApiProperty()
  _id!: string;

  @ApiProperty()
  projectId!: string;

  @ApiPropertyOptional()
  reportedBy?: string | null;

  @ApiPropertyOptional()
  revisionId?: string;

  @ApiProperty({ enum: ProjectErrorKind })
  kind!: ProjectErrorKind;

  @ApiProperty()
  message!: string;

  @ApiPropertyOptional()
  stack?: string;

  @ApiPropertyOptional()
  source?: string;

  @ApiPropertyOptional()
  line?: number;

  @ApiPropertyOptional()
  col?: number;

  @ApiPropertyOptional()
  pageUrl?: string;

  @ApiPropertyOptional()
  userAgent?: string;

  @ApiProperty()
  fingerprint!: string;

  @ApiProperty()
  occurrences!: number;

  @ApiProperty()
  firstSeenAt!: string;

  @ApiProperty()
  lastSeenAt!: string;

  @ApiProperty({ enum: ProjectErrorStatus })
  status!: ProjectErrorStatus;

  @ApiProperty()
  sentToChat!: boolean;
}

export class UpdateProjectErrorDto {
  @ApiPropertyOptional({ enum: ProjectErrorStatus })
  @IsOptional()
  @IsEnum(ProjectErrorStatus)
  status?: ProjectErrorStatus;

  @ApiPropertyOptional()
  @IsOptional()
  sentToChat?: boolean;
}
