import { ApiProperty } from '@nestjs/swagger';
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
  @ApiProperty({ type: String, example: '#7C3AED' })
  @IsHexColor()
  primary: string;

  @ApiProperty({ type: String, example: '#F4B393' })
  @IsHexColor()
  accent: string;

  @ApiProperty({ type: String, example: '#FFFFFF' })
  @IsHexColor()
  background: string;

  @ApiProperty({ type: String, example: '#0F172A' })
  @IsHexColor()
  foreground: string;
}

export class SaveQuestionnaireOptionDto {
  @ApiProperty({ type: String })
  @IsString()
  @IsNotEmpty()
  label: string;

  @ApiProperty({ type: String, required: false })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({
    type: SaveQuestionnairePaletteColorsDto,
    required: false,
    nullable: true,
    description:
      'Hex palette for `kind: "theme"` options. Null for the Auto / let-AI-pick option.',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => SaveQuestionnairePaletteColorsDto)
  colors?: SaveQuestionnairePaletteColorsDto | null;
}

export class SaveQuestionnaireQuestionDto {
  @ApiProperty({ type: String })
  @IsString()
  @IsNotEmpty()
  id: string;

  @ApiProperty({ type: String })
  @IsString()
  @IsNotEmpty()
  question: string;

  @ApiProperty({ type: String, enum: ['single', 'multiple'] })
  @IsEnum(['single', 'multiple'])
  type: 'single' | 'multiple';

  @ApiProperty({ type: [SaveQuestionnaireOptionDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SaveQuestionnaireOptionDto)
  options: SaveQuestionnaireOptionDto[];

  @ApiProperty({ type: Boolean, required: false })
  @IsOptional()
  @IsBoolean()
  required?: boolean;

  @ApiProperty({
    type: String,
    enum: ['theme'],
    required: false,
    description:
      "Marks special UI variants. `'theme'` triggers the design-system picker on the frontend.",
  })
  @IsOptional()
  @IsEnum(['theme'])
  kind?: 'theme';

  @ApiProperty({
    type: [String],
    enum: ['light', 'dark', 'auto'],
    required: false,
    description: "Mode toggle options on `kind: 'theme'` questions.",
  })
  @IsOptional()
  @IsArray()
  @IsEnum(['light', 'dark', 'auto'], { each: true })
  modeOptions?: Array<'light' | 'dark' | 'auto'>;
}

export class SaveQuestionnaireDto {
  @ApiProperty({ type: [SaveQuestionnaireQuestionDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SaveQuestionnaireQuestionDto)
  questions: SaveQuestionnaireQuestionDto[];

  @ApiProperty({ type: String, required: false })
  @IsOptional()
  @IsString()
  estimatedTime?: string;
}
