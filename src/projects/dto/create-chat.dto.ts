import { ApiProperty } from '@nestjs/swagger';
import { IsMongoId, IsString, IsOptional, IsEnum } from 'class-validator';
import { Types } from 'mongoose';

export class CreateChatDto {
  @ApiProperty({
    type: String,
    example: '507f1f77bcf86cd7994390',
    required: true,
  })
  @IsMongoId({ message: 'projectId must be a valid MongoDB ObjectId' })
  projectId: Types.ObjectId;

  @ApiProperty({
    type: String,
    example: 'How do I implement authentication?',
    required: true,
  })
  @IsString({ message: 'message must be a string' })
  message: string;

  @ApiProperty({
    type: String,
    enum: ['user', 'assistant'],
    example: 'user',
    required: false,
  })
  @IsOptional()
  @IsEnum(['user', 'assistant'], {
    message: 'role must be either "user" or "assistant"',
  })
  role?: string;

  @ApiProperty({
    type: String,
    enum: [
      'markdown',
      'deployment',
      'code-generation',
      'questionnaire',
      'execution-plan',
      'patch-update',
    ],
    example: 'markdown',
    required: false,
    description: 'Message type for assistant messages',
  })
  @IsOptional()
  @IsEnum(
    [
      'markdown',
      'deployment',
      'code-generation',
      'questionnaire',
      'execution-plan',
      'patch-update',
    ],
    {
      message:
        'messageType must be one of: markdown, deployment, code-generation, questionnaire, execution-plan, patch-update',
    },
  )
  messageType?: string;

  @ApiProperty({
    type: Object,
    example: { previewUrl: 'https://example.com', progress: {} },
    required: false,
    description: 'Additional metadata for the message (progress, URLs, etc.)',
  })
  @IsOptional()
  metadata?: Record<string, any>;
}
