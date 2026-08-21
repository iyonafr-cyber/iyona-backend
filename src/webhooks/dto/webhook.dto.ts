import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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
  @ApiProperty({ example: 'Slack #builds notifier' })
  @IsString()
  @Length(1, 80)
  name!: string;

  @ApiProperty({ example: 'https://example.com/jarvis/hooks' })
  @IsUrl({ require_protocol: true })
  url!: string;

  @ApiProperty({ enum: EVENT_VALUES, isArray: true })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsEnum(EVENT_VALUES, { each: true })
  events!: (typeof EVENT_VALUES)[number][];
}

export class UpdateWebhookDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 80)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl({ require_protocol: true })
  url?: string;

  @ApiPropertyOptional({ enum: EVENT_VALUES, isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsEnum(EVENT_VALUES, { each: true })
  events?: (typeof EVENT_VALUES)[number][];

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
