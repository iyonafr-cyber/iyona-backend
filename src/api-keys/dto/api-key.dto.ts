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
  @IsString()
  @Length(1, 80)
  name!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsEnum(SCOPE_VALUES, { each: true })
  scopes!: (typeof SCOPE_VALUES)[number][];

  @IsOptional()
  @IsISO8601()
  expiresAt?: string;
}
