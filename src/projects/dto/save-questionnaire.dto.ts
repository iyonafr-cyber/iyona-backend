import {
  IsString,
  IsArray,
  IsOptional,
  ValidateNested,
  IsEnum,
  IsBoolean,
  IsNotEmpty,
  IsHexColor,
} from 'class-validator';
import { Type } from 'class-transformer';

export class SaveQuestionnairePaletteColorsDto {
  @IsHexColor()
  primary: string;

  @IsHexColor()
  accent: string;

  @IsHexColor()
  background: string;

  @IsHexColor()
  foreground: string;
}

export class SaveQuestionnaireOptionDto {
  @IsString()
  @IsNotEmpty()
  label: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => SaveQuestionnairePaletteColorsDto)
  colors?: SaveQuestionnairePaletteColorsDto | null;
}

export class SaveQuestionnaireQuestionDto {
  @IsString()
  @IsNotEmpty()
  id: string;

  @IsString()
  @IsNotEmpty()
  question: string;

  @IsEnum(['single', 'multiple'])
  type: 'single' | 'multiple';

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SaveQuestionnaireOptionDto)
  options: SaveQuestionnaireOptionDto[];

  @IsOptional()
  @IsBoolean()
  required?: boolean;

  @IsOptional()
  @IsEnum(['theme'])
  kind?: 'theme';

  @IsOptional()
  @IsArray()
  @IsEnum(['light', 'dark', 'auto'], { each: true })
  modeOptions?: Array<'light' | 'dark' | 'auto'>;
}

export class SaveQuestionnaireDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SaveQuestionnaireQuestionDto)
  questions: SaveQuestionnaireQuestionDto[];

  @IsOptional()
  @IsString()
  estimatedTime?: string;
}
