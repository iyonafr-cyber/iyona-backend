import { IsBoolean, IsOptional, IsString } from 'class-validator';

/**
 * Explicit update shape for `UserProject`. Unlike `Partial<CreateUserProjectDto>`
 * this intentionally omits server-controlled fields (userId, stage, generation,
 * deployment, payment config, etc.) to prevent mass-assignment.
 */
export class UpdateUserProjectDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  initialPrompt?: string;

  @IsOptional()
  @IsString()
  defaultModelId?: string;
}
