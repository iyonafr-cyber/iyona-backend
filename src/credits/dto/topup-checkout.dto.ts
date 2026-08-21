import { IsIn, IsOptional, IsString } from 'class-validator';
import { TOPUP_PACKS } from '../constants/plans';

export class TopupCheckoutDto {
  @IsString()
  @IsIn(TOPUP_PACKS.map((p) => p.id))
  pack: 'topup_small' | 'topup_medium' | 'topup_large';

  @IsOptional()
  @IsString()
  successUrl?: string;

  @IsOptional()
  @IsString()
  cancelUrl?: string;
}
