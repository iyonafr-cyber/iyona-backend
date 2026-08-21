import { IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class LogoutDto {
  @ApiProperty({
    description: 'The token of the user',
    example: 'dfhjkldsdfhjil;kojhdfhgjhk;kjhgch',
  })
  @IsNotEmpty({ message: 'token is required' })
  refreshToken: string;
}
