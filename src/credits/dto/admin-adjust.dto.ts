import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class AdminAdjustDto {
  @IsString()
  @IsNotEmpty()
  userId: string;

  @IsInt()
  amount: number;

  @IsOptional()
  @IsIn(['monthly', 'topup'])
  bucket?: 'monthly' | 'topup';

  @IsString()
  @IsNotEmpty()
  reason: string;
}
