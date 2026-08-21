import { IsBoolean, IsEmail, IsOptional, IsString } from 'class-validator';

export class CreateUserSocialDto {
  @IsEmail({}, { message: 'Invalid email format' })
  email: string;

  @IsString()
  firstName: string;

  @IsOptional()
  @IsBoolean()
  githubConnected?: boolean;
}
