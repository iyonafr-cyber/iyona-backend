import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class UpdateProviderKeyDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  priority?: number;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  supportedModels?: string[];

  @ApiPropertyOptional({
    description: 'Set new secret; replaces encrypted value',
  })
  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(4096)
  apiKey?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(512)
  openaiBaseUrl?: string | null;

  @ApiPropertyOptional({
    enum: ['healthy', 'rate_limited', 'quota_exceeded', 'disabled', 'invalid'],
  })
  @IsOptional()
  @IsString()
  @IsIn(['healthy', 'rate_limited', 'quota_exceeded', 'disabled', 'invalid'])
  healthStatus?:
    | 'healthy'
    | 'rate_limited'
    | 'quota_exceeded'
    | 'disabled'
    | 'invalid';
}
