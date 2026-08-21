import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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
  @ApiProperty({ enum: ['openai', 'anthropic', 'google'] })
  @IsString()
  @IsIn(['openai', 'anthropic', 'google'])
  provider: 'openai' | 'anthropic' | 'google';

  @ApiProperty({ example: 'Primary OpenAI' })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name: string;

  @ApiProperty({ description: 'Plain API key (stored encrypted server-side)' })
  @IsString()
  @MinLength(8)
  @MaxLength(4096)
  apiKey: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ default: 100, description: 'Lower = tried first' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  priority?: number;

  @ApiPropertyOptional({
    description: 'Restrict to these model ids; omit or empty = all models',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  supportedModels?: string[];

  @ApiPropertyOptional({
    description: 'OpenAI-compatible base URL (OpenAI keys only)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  openaiBaseUrl?: string;
}
