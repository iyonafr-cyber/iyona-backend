import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';

/**
 * Explicit update shape for chat documents. Intentionally excludes `projectId`
 * so callers can't reassign a chat to a project they don't own.
 */
export class UpdateChatDto {
  @IsOptional()
  @IsString()
  message?: string;

  @IsOptional()
  @IsEnum(['user', 'assistant'])
  role?: string;

  @IsOptional()
  @IsEnum([
    'markdown',
    'deployment',
    'code-generation',
    'questionnaire',
    'execution-plan',
    'patch-update',
  ])
  messageType?: string;

  @IsOptional()
  metadata?: Record<string, any>;
}

/**
 * Body for re-running a prompt with corrected wording. Deliberately only
 * carries `message`: an edit must not be able to change the role or
 * message type of an existing turn.
 */
export class EditChatDto {
  @IsString()
  @IsNotEmpty()
  message: string;
}

/**
 * Body shape for creating a chat under `/projects/:projectId/chats`. We don't
 * accept `projectId` in the body to avoid the "create a chat pointing at
 * someone else's project" attack; the URL param is authoritative and the
 * controller layers on `assertProjectOwner`.
 */
export class CreateChatBodyDto {
  @IsString()
  message: string;

  @IsOptional()
  @IsEnum(['user', 'assistant'])
  role?: string;

  @IsOptional()
  @IsEnum([
    'markdown',
    'deployment',
    'code-generation',
    'questionnaire',
    'execution-plan',
    'patch-update',
  ])
  messageType?: string;

  @IsOptional()
  metadata?: Record<string, any>;
}
