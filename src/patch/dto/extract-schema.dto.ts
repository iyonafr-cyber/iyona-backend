import { IsObject, IsOptional, IsString } from 'class-validator';
export class ExtractSchemaDto {
  @IsObject()
  files: Record<string, string>;

  @IsOptional()
  @IsObject()
  executionPlan?: Record<string, any>;

  @IsOptional()
  @IsString()
  modelId?: string;
}
