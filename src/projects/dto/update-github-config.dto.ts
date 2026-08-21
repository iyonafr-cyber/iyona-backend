import { IsBoolean, IsOptional, IsString, Matches } from 'class-validator';

/**
 * Per-project GitHub configuration. `autoPush` is off by default: pushes only
 * happen when the user has explicitly enabled them for this project and a
 * repository handle is already persisted.
 */
export class UpdateGitHubConfigDto {
  @IsOptional()
  @IsString()
  @Matches(/^[^\s/]+\/[^\s/]+$/, {
    message: 'repository must be in the form "owner/repo"',
  })
  repository?: string;

  @IsOptional()
  @IsString()
  branch?: string;

  @IsOptional()
  @IsBoolean()
  autoPush?: boolean;
}
