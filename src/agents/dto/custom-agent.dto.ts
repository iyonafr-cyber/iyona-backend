import { ApiProperty } from '@nestjs/swagger';
import {
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * Payload for creating a custom specialist. `slug` is optional — when
 * omitted the service derives one from `name`.
 */
export class CreateCustomAgentDto {
  @ApiProperty({ description: 'Display name, e.g. "Marketing Writer".' })
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  name!: string;

  @ApiProperty({
    description:
      'Optional command slug (lowercase letters, digits, hyphen, underscore). Derived from the name when omitted.',
    required: false,
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  @Matches(/^[a-z0-9][a-z0-9_-]*$/, {
    message: 'slug must be lowercase letters, digits, hyphen or underscore',
  })
  slug?: string;

  @ApiProperty({
    description: 'One-line summary shown in the picker.',
    required: false,
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  description?: string;

  @ApiProperty({ description: 'Optional lucide icon name.', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  icon?: string;

  @ApiProperty({
    description: 'The specialist instructions (used as the system prompt).',
  })
  @IsString()
  @MinLength(10)
  @MaxLength(20000)
  instructions!: string;
}

/**
 * Partial update — every field optional. Slug is intentionally immutable
 * after creation (it's the command handle), so it is not accepted here.
 */
export class UpdateCustomAgentDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  name?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  description?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  icon?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MinLength(10)
  @MaxLength(20000)
  instructions?: string;
}
