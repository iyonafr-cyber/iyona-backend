import { IsString, IsNotEmpty, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
export class FileContentDto {
  @IsString()
  @IsNotEmpty()
  path: string;

  @IsString()
  @IsNotEmpty()
  content: string;
}

export class PushFilesDto {
  @IsString()
  @IsNotEmpty()
  repository: string;

  @IsString()
  @IsNotEmpty()
  message: string;

  @IsString()
  @IsNotEmpty()
  branch?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FileContentDto)
  files: FileContentDto[];
}
