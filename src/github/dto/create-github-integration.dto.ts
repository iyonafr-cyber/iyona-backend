import { IsString, IsNotEmpty, IsOptional } from 'class-validator';
export class CreateGitHubIntegrationDto {
  @IsString()
  @IsNotEmpty()
  accessToken: string;

  @IsString()
  @IsOptional()
  refreshToken?: string;

  @IsOptional()
  tokenExpiresAt?: Date;
}
