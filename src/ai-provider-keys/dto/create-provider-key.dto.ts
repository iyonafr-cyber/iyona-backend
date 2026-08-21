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

export class CreateProviderKeyDto {
  @IsString()
  @IsIn(['openai', 'anthropic', 'google'])
  provider: 'openai' | 'anthropic' | 'google';

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name: string;

  @IsString()
  @MinLength(8)
  @MaxLength(4096)
  apiKey: string;

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
  @MaxLength(512)
  openaiBaseUrl?: string;
}
