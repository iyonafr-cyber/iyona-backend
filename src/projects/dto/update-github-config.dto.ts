import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, Matches } from 'class-validator';

/**
 * Per-project GitHub configuration. `autoPush` is off by default: pushes only
 * happen when the user has explicitly enabled them for this project and a
 * repository handle is already persisted.
 */
export class UpdateGitHubConfigDto {
  @ApiProperty({
    description: 'GitHub repository handle in owner/repo format',
    example: 'acme/generated-app-abc',
    required: false,
  })
  @IsOptional()
  @IsString()
  @Matches(/^[^\s/]+\/[^\s/]+$/, {
    message: 'repository must be in the form "owner/repo"',
  })
  repository?: string;

  @ApiProperty({
    description: 'Default branch',
    required: false,
    example: 'main',
  })
  @IsOptional()
  @IsString()
  branch?: string;

  @ApiProperty({
    description: 'Automatically push to GitHub after every code generation',
    required: false,
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  autoPush?: boolean;
}
