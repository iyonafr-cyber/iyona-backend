export class ComponentSchemaDto {
  _id: string;

  projectId: string;

  componentId: string;

  type: string;

  name: string;

  description?: string;

  pageName?: string;

  filePath: string;

  generatedCode?: string;

  dependencies: string[];

  props: Record<string, any>;

  styles: Record<string, any>;

  layout: Record<string, any>;

  content: Record<string, any>;

  version: number;

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
