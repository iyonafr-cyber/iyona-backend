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
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(0)
  priority?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  supportedModels?: string[];

  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(4096)
  apiKey?: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  openaiBaseUrl?: string | null;

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
