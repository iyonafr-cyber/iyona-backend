import { IsString, IsNotEmpty, IsObject, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { LocaleHintsMixin } from '../../common/locale-hints.dto';

export class GenerateExecutionPlanDto extends LocaleHintsMixin {
  @ApiProperty({
    description: 'Project idea/description',
    example: 'A todo app with user authentication',
  })
  @IsString()
  @IsNotEmpty()
  projectIdea: string;

  @ApiProperty({
    description: 'Questionnaire answers',
    example: {
      targetAudience: 'Students and professionals',
      keyFeatures: 'Task creation, deadlines, categories',
    },
  })
  @IsObject()
  @IsNotEmpty()
  answers: Record<string, any>;

  @ApiProperty({
    description:
      'Map of questionId → question text so the AI sees what each answer refers to',
    required: false,
    example: {
      targetAudience: 'Who is the target audience for this app?',
      keyFeatures: 'What key features do you want?',
    },
  })
  @IsOptional()
  @IsObject()
  questionLabels?: Record<string, string>;

  @ApiProperty({
    description: "Optional model override (pass 'auto' for default routing)",
    required: false,
  })
  @IsOptional()
  @IsString()
  modelId?: string;
}
