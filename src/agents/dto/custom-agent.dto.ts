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
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  @Matches(/^[a-z0-9][a-z0-9_-]*$/, {
    message: 'slug must be lowercase letters, digits, hyphen or underscore',
  })
  slug?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  icon?: string;

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
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  icon?: string;

  @IsOptional()
  @IsString()
  @MinLength(10)
  @MaxLength(20000)
  instructions?: string;
}
