import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ComponentSchemaDto {
  @ApiProperty()
  _id: string;

  @ApiProperty()
  projectId: string;

  @ApiProperty()
  componentId: string;

  @ApiProperty()
  type: string;

  @ApiProperty()
  name: string;

  @ApiPropertyOptional()
  description?: string;

  @ApiPropertyOptional()
  pageName?: string;

  @ApiProperty()
  filePath: string;

  @ApiPropertyOptional({
    description:
      'Latest generated code for this file.',
  })
  generatedCode?: string;

  @ApiProperty()
  dependencies: string[];

  @ApiProperty()
  props: Record<string, any>;

  @ApiProperty()
  styles: Record<string, any>;

  @ApiProperty()
  layout: Record<string, any>;

  @ApiProperty()
  content: Record<string, any>;

  @ApiProperty()
  version: number;

  @ApiProperty()
  versionHistory: Array<{
    version: number;
    props: Record<string, any>;
    styles: Record<string, any>;
    layout: Record<string, any>;
    content: Record<string, any>;
    generatedCode?: string;
    commitMessage?: string;
    createdAt: Date;
  }>;
}
