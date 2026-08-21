import { IsObject, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ExtractSchemaDto {
  @ApiProperty({ description: 'Generated files (path -> content)' })
  @IsObject()
  files: Record<string, string>;

  @ApiPropertyOptional({ description: 'Execution plan for context' })
  @IsOptional()
  @IsObject()
  executionPlan?: Record<string, any>;

  @ApiPropertyOptional({
    description:
      "Optional model override. Pass 'auto' or omit to let the server pick.",
  })
  @IsOptional()
  @IsString()
  modelId?: string;
}
