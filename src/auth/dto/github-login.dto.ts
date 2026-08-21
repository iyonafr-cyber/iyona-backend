import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class GitHubLoginDto {
  @ApiProperty({
    type: String,
    description:
      'Authorization code returned from the GitHub OAuth redirect. The backend exchanges it for an access token so the client secret never leaves the server.',
    required: true,
  })
  @IsString()
  @IsNotEmpty()
  code: string;

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
