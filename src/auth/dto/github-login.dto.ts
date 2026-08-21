import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class GitHubLoginDto {
  @IsString()
  @IsNotEmpty()
  code: string;

  @IsOptional()
  @IsString()
  state?: string;
}
