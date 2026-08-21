import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsEmail, IsOptional, IsString } from 'class-validator';

export class CreateUserSocialDto {
  @ApiProperty({
    type: String,
    description: 'Email of the user',
    example: 'abdulwadoodowner@gmail.com',
    required: true,
  })
  @IsEmail({}, { message: 'Invalid email format' })
  email: string;

  @ApiProperty({
    type: String,
    description: 'first Name of user',
    minLength: 8,
    example: 'Abdul Wadood',
    required: true,
  })
  @IsString()
  firstName: string;

  @IsOptional()
  @IsBoolean()
  githubConnected?: boolean;
}
