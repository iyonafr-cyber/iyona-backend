import { IsString, IsNotEmpty, IsObject, IsOptional } from 'class-validator';
/** Trigger the spec→Cursor build path for one project (prototype A/B). */
export class RunSpecBuildDto {
  @IsString()
  @IsNotEmpty()
  projectId: string;

  @IsString()
  @IsNotEmpty()
  projectIdea: string;

  @IsObject()
  @IsOptional()
  answers?: Record<string, unknown>;

  @IsObject()
  @IsOptional()
  questionLabels?: Record<string, string>;
}
