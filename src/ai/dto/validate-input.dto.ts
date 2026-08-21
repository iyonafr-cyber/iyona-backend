import { IsString, IsNotEmpty, IsOptional, IsArray } from 'class-validator';
import { LocaleHintsMixin } from '../../common/locale-hints.dto';

export class ValidateInputDto extends LocaleHintsMixin {
  @IsString()
  @IsNotEmpty()
  input: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  images?: string[];

  @IsOptional()
  @IsString()
  modelId?: string;
}
