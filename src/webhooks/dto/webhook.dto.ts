import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  IsUrl,
  Length,
} from 'class-validator';
import { ALL_WEBHOOK_EVENTS } from '../entities/webhook.entity';

const EVENT_VALUES = ALL_WEBHOOK_EVENTS;

export class CreateWebhookDto {
  @IsString()
  @Length(1, 80)
  name!: string;

  @IsUrl({ require_protocol: true })
  url!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsEnum(EVENT_VALUES, { each: true })
  events!: (typeof EVENT_VALUES)[number][];
}

export class UpdateWebhookDto {
  @IsOptional()
  @IsString()
  @Length(1, 80)
  name?: string;

  @IsOptional()
  @IsUrl({ require_protocol: true })
  url?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsEnum(EVENT_VALUES, { each: true })
  events?: (typeof EVENT_VALUES)[number][];

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
