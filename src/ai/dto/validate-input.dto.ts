import { IsString, IsNotEmpty, IsOptional, IsArray } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { LocaleHintsMixin } from '../../common/locale-hints.dto';

export class ValidateInputDto extends LocaleHintsMixin {
  @ApiProperty({
    description: 'User input to validate',
    example: 'Create a todo app with user authentication',
  })
  @IsString()
  @IsNotEmpty()
  input: string;

  @ApiProperty({
    description: 'Optional images (base64 data URLs)',
    required: false,
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  images?: string[];

  @ApiProperty({
    description: "Optional model override (pass 'auto' for default routing)",
    required: false,
  })
  @IsOptional()
  @IsString()
  modelId?: string;
}
