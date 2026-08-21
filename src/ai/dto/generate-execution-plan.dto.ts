import { IsString, IsNotEmpty, IsObject, IsOptional } from 'class-validator';
import { LocaleHintsMixin } from '../../common/locale-hints.dto';

export class GenerateExecutionPlanDto extends LocaleHintsMixin {
  @IsString()
  @IsNotEmpty()
  projectIdea: string;

  @IsObject()
  @IsNotEmpty()
  answers: Record<string, any>;

  @IsOptional()
  @IsObject()
  questionLabels?: Record<string, string>;

  @IsOptional()
  @IsString()
  modelId?: string;
}
