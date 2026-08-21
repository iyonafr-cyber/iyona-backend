import { IsMongoId, IsString, IsOptional, IsEnum } from 'class-validator';
import { Types } from 'mongoose';

export class CreateChatDto {
  @IsMongoId({ message: 'projectId must be a valid MongoDB ObjectId' })
  projectId: Types.ObjectId;

  @IsString({ message: 'message must be a string' })
  message: string;

  @IsOptional()
  @IsEnum(['user', 'assistant'], {
    message: 'role must be either "user" or "assistant"',
  })
  role?: string;

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

  @IsOptional()
  metadata?: Record<string, any>;
}
