import { IsString, IsNotEmpty, IsOptional } from 'class-validator';
export class GitHubOAuthCallbackDto {
  @IsString()
  @IsNotEmpty()
  code: string;

  @IsString()
  @IsOptional()
  state?: string;
}
