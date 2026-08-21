import { Exclude, Expose } from 'class-transformer';
export class GitHubIntegrationDto {
  @Expose()
  _id: string;

  @Expose()
  userId: string;

  @Expose()
  githubUsername: string;

  @Expose()
  repositoryIds?: string[];

  @Expose()
  isActive: boolean;

  @Expose()
  metadata?: {
    avatarUrl?: string;
    email?: string;
    name?: string;
    bio?: string;
  };

  @Expose()
  createdAt: Date;

  @Expose()
  updatedAt: Date;

  @Exclude()
  accessToken: string;

  @Exclude()
  refreshToken?: string;

  @Exclude()
  tokenExpiresAt?: Date;
}
