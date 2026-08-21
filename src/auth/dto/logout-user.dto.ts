import { IsNotEmpty } from 'class-validator';
export class LogoutDto {
  @IsNotEmpty({ message: 'token is required' })
  refreshToken: string;
}
