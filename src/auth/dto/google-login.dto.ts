import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class GoogleLoginDto {
  @ApiProperty({
    type: String,
    description: 'Google OAuth access token',
    example: 'ya29.a0AfH6SMC...',
    required: true,
  })
  @IsString()
  @IsNotEmpty()
  accessToken: string;

  @ApiProperty({
    type: String,
    description:
      'HMAC-signed OAuth state nonce obtained from POST /auth/oauth/state. Required when OAUTH_STATE_REQUIRED=true.',
    required: false,
  })
  @IsOptional()
  @IsString()
  state?: string;
}
