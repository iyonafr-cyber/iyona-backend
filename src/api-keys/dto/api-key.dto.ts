import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsISO8601,
  IsOptional,
  IsString,
  Length,
} from 'class-validator';

const SCOPE_VALUES = [
  'projects:read',
  'projects:write',
  'webhooks:read',
  'webhooks:write',
  'admin',
] as const;

export class CreateApiKeyDto {
  @ApiProperty({ example: 'CI deploy bot' })
  @IsString()
  @Length(1, 80)
  name!: string;

  @ApiProperty({ enum: SCOPE_VALUES, isArray: true })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsEnum(SCOPE_VALUES, { each: true })
  scopes!: (typeof SCOPE_VALUES)[number][];

  @ApiPropertyOptional({ description: 'ISO 8601 expiry timestamp.' })
  @IsOptional()
  @IsISO8601()
  expiresAt?: string;
}
