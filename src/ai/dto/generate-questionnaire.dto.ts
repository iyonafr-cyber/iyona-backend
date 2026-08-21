import { IsString, IsNotEmpty, IsOptional } from 'class-validator';
import { LocaleHintsMixin } from '../../common/locale-hints.dto';

export class GenerateQuestionnaireDto extends LocaleHintsMixin {
  @IsString()
  @IsNotEmpty()
  projectIdea: string;

  @IsString()
  @IsNotEmpty()
  projectName: string;

  @IsOptional()
  @IsString()
  modelId?: string;
}
