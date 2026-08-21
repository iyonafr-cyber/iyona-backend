import { IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export { ExtractSchemaDto } from '../../patch/dto/extract-schema.dto';

export class RollbackComponentDto {
  @ApiProperty({ description: 'Version to rollback to' })
  @IsString()
  version: string;
}
