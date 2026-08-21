import { IsString, IsNotEmpty, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { LocaleHintsMixin } from '../../common/locale-hints.dto';

export class GenerateQuestionnaireDto extends LocaleHintsMixin {
  @ApiProperty({
    description: 'Project idea/description',
    example: 'A todo app with user authentication',
  })
  @IsString()
  @IsNotEmpty()
  projectIdea: string;

  @ApiProperty({
    description: 'Project name',
    example: 'Task Manager Pro',
  })
  @IsString()
  @IsNotEmpty()
  projectName: string;

  @ApiProperty({
    description: "Optional model override (pass 'auto' for default routing)",
    required: false,
  })
  @IsOptional()
  @IsString()
  modelId?: string;
}
