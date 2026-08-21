import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
} from 'class-validator';

/**
 * DTO for `POST /projects/:id/workflow/complete-code-generation`.
 * Replaces the previous inline `{ generatedFiles: string[] }` body so
 * the global `ValidationPipe` can reject malformed payloads at the
 * edge instead of failing deep inside `ProjectsService`.
 */
export class CompleteCodeGenerationDto {
  @ApiProperty({
    type: [String],
    description: 'Relative file paths produced during code generation',
    example: ['src/App.jsx', 'src/components/Header.jsx'],
  })
  @IsArray({ message: 'generatedFiles must be an array of strings' })
  @ArrayNotEmpty({ message: 'generatedFiles cannot be empty' })
  @ArrayMaxSize(2000, {
    message: 'generatedFiles cannot list more than 2000 files',
  })
  @IsString({
    each: true,
    message: 'each generatedFiles entry must be a string',
  })
  @MaxLength(512, {
    each: true,
    message: 'each generatedFiles entry must be at most 512 characters',
  })
  generatedFiles: string[];
}

/**
 * DTO for `POST /projects/:id/workflow/complete-deployment`. Vercel
 * gives us a deployment id and a preview URL; both must be present
 * and look like a URL.
 */
export class CompleteDeploymentDto {
  @ApiProperty({ type: String, example: 'dpl_abc123' })
  @IsString({ message: 'deploymentId must be a string' })
  @IsNotEmpty({ message: 'deploymentId is required' })
  @MaxLength(128)
  deploymentId: string;

  @ApiProperty({ type: String, example: 'https://my-project.vercel.app' })
  @IsString({ message: 'previewUrl must be a string' })
  @IsUrl(
    { require_tld: false, require_protocol: true },
    { message: 'previewUrl must be a valid URL' },
  )
  @MaxLength(2048)
  previewUrl: string;
}

/**
 * DTO for `POST /projects/:id/workflow/fail-stage`. The stage's error
 * message is appended to the workflow audit log so the SPA can show
 * "why" the project transitioned to `failed`.
 */
export class FailStageDto {
  @ApiProperty({
    type: String,
    required: false,
    example: 'OpenAI returned 500',
  })
  @IsOptional()
  @IsString({ message: 'errorMessage must be a string' })
  @MaxLength(2000)
  errorMessage?: string;
}
