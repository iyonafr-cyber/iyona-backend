import { IsOptional, IsBoolean, IsString, IsIn } from 'class-validator';

export class UpdatePaymentConfigDto {
  @IsOptional()
  @IsBoolean({ message: 'enabled must be a boolean' })
  enabled?: boolean;

  @IsOptional()
  @IsString({ message: 'stripePublishableKey must be a string' })
  stripePublishableKey?: string;

  @IsOptional()
  @IsString({ message: 'stripeSecretKey must be a string' })
  stripeSecretKey?: string;

  @IsOptional()
  @IsIn(['test', 'live'], { message: 'stripeMode must be either test or live' })
  stripeMode?: 'test' | 'live';
}
