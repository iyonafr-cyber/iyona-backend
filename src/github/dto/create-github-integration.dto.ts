import { IsString, IsNotEmpty, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateGitHubIntegrationDto {
  @ApiProperty({ description: 'GitHub access token' })
  @IsString()
  @IsNotEmpty()
  accessToken: string;

  @ApiPropertyOptional({ description: 'GitHub refresh token' })
  @IsString()
  @IsOptional()
  refreshToken?: string;

  @ApiPropertyOptional({ description: 'Token expiration date' })
  @IsOptional()
  tokenExpiresAt?: Date;
}
