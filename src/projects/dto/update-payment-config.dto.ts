import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsBoolean, IsString, IsIn } from 'class-validator';

export class UpdatePaymentConfigDto {
  @ApiProperty({
    type: Boolean,
    description: 'Enable or disable payments for this project',
    required: false,
  })
  @IsOptional()
  @IsBoolean({ message: 'enabled must be a boolean' })
  enabled?: boolean;

  @ApiProperty({
    type: String,
    description: 'Stripe Publishable Key (pk_test_... or pk_live_...)',
    required: false,
  })
  @IsOptional()
  @IsString({ message: 'stripePublishableKey must be a string' })
  stripePublishableKey?: string;

  @ApiProperty({
    type: String,
    description: 'Stripe Secret Key (sk_test_... or sk_live_...)',
    required: false,
  })
  @IsOptional()
  @IsString({ message: 'stripeSecretKey must be a string' })
  stripeSecretKey?: string;

  @ApiProperty({
    type: String,
    enum: ['test', 'live'],
    description: 'Stripe mode - test or live',
    required: false,
  })
  @IsOptional()
  @IsIn(['test', 'live'], { message: 'stripeMode must be either test or live' })
  stripeMode?: 'test' | 'live';
}
