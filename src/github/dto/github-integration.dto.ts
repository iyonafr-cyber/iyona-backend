import { Exclude, Expose } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class GitHubIntegrationDto {
  @ApiProperty()
  @Expose()
  _id: string;

  @ApiProperty()
  @Expose()
  userId: string;

  @ApiProperty()
  @Expose()
  githubUsername: string;

  @ApiPropertyOptional()
  @Expose()
  repositoryIds?: string[];

  @ApiProperty()
  @Expose()
  isActive: boolean;

  @ApiPropertyOptional()
  @Expose()
  metadata?: {
    avatarUrl?: string;
    email?: string;
    name?: string;
    bio?: string;
  };

  @ApiProperty()
  @Expose()
  createdAt: Date;

  @ApiProperty()
  @Expose()
  updatedAt: Date;

  @Exclude()
  accessToken: string;

  @Exclude()
  refreshToken?: string;

  @Exclude()
  tokenExpiresAt?: Date;
}
