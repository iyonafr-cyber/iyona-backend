import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString } from 'class-validator';

/**
 * Explicit update shape for `UserProject`. Unlike `Partial<CreateUserProjectDto>`
 * this intentionally omits server-controlled fields (userId, stage, generation,
 * deployment, payment config, etc.) to prevent mass-assignment.
 */
export class UpdateUserProjectDto {
  @ApiProperty({ type: String, required: false })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiProperty({ type: String, required: false })
  @IsOptional()
  @IsString()
  initialPrompt?: string;

  @ApiProperty({
    type: String,
    required: false,
    description:
      "Per-project default AI model. `'auto'` or empty clears the override.",
  })
  @IsOptional()
  @IsString()
  defaultModelId?: string;
}
