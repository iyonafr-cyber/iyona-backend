import { IsString, IsNotEmpty, IsObject, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/** Trigger the spec→Cursor build path for one project (prototype A/B). */
export class RunSpecBuildDto {
  @ApiProperty({
    description: 'Project id to build into (must have a Jarvis GitHub repo).',
  })
  @IsString()
  @IsNotEmpty()
  projectId: string;

  @ApiProperty({ description: 'The user product idea.' })
  @IsString()
  @IsNotEmpty()
  projectIdea: string;

  @ApiProperty({
    description:
      'Questionnaire answers (same shape as the execution-plan flow). Include a "theme" key for the palette.',
    required: false,
  })
  @IsObject()
  @IsOptional()
  answers?: Record<string, unknown>;

  @ApiProperty({
    description: 'Optional map of question id → human label.',
    required: false,
  })
  @IsObject()
  @IsOptional()
  questionLabels?: Record<string, string>;
}
