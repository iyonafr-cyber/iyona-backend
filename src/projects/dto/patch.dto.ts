import { IsString } from 'class-validator';
export { ExtractSchemaDto } from '../../patch/dto/extract-schema.dto';

export class RollbackComponentDto {
  @IsString()
  version: string;
}
