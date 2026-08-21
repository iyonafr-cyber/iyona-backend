import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { randomUUID, createHash } from 'crypto';
import * as path from 'path';

import {
  ComponentSchema,
  ComponentType,
  ComponentVersion,
} from './entities/component-schema.entity';
import {
  ProjectSnapshot,
  ComponentSnapshot,
} from './entities/project-snapshot.entity';
import { UserProject } from '../projects/entities/user-project.entity';
import { ComponentSchemaDto } from './dto/component-schema.dto';
import { plainToInstance } from 'class-transformer';
import { CreditsService } from '../credits/credits.service';
import { LlmMessage, LlmService } from '../credits/llm.service';
import { PricingService } from '../credits/pricing.service';
import { CreditActionKey } from '../credits/constants/credit-actions';
import { RouterTask } from '../credits/model-router.service';

export interface PatchCallContext {
  userId: string;
  requestId?: string;
  modelId?: string;
  projectDefaultModelId?: string;
}

export interface PatchCreditMeta {
  creditsCharged: number;
  balanceAfter: number;
}

@Injectable()
export class PatchService {
  private readonly logger = new Logger(PatchService.name);

  constructor(
    @InjectModel(ComponentSchema.name)
    private componentSchemaModel: Model<ComponentSchema>,
    @InjectModel(ProjectSnapshot.name)
    private projectSnapshotModel: Model<ProjectSnapshot>,
    @InjectModel(UserProject.name)
    private projectModel: Model<UserProject>,
    private readonly llm: LlmService,
    private readonly credits: CreditsService,
    private readonly pricing: PricingService,
  ) {}

  /**
   * Cascade-delete this module's per-project data (component schemas + version
   * snapshots) when a project is hard-purged. Best-effort; the caller logs.
   */
  async purgeProjectData(projectId: string): Promise<void> {
    await Promise.all([
      this.componentSchemaModel.deleteMany({ projectId }).exec(),
      this.projectSnapshotModel.deleteMany({ projectId }).exec(),
    ]);
  }

  // ──────────────────────────────────────────────────────────────
  // Billed chat helper (used by extractComponentSchema)
  // ──────────────────────────────────────────────────────────────

  private async meteredChat(params: {
    ctx: PatchCallContext;
    action: CreditActionKey;
    task: RouterTask;
    messages: LlmMessage[];
    temperature?: number;
    jsonMode?: boolean;
    maxOutputTokens?: number;
    projectId?: string;
  }): Promise<{ content: string; meta: PatchCreditMeta }> {
    const requestId = params.ctx.requestId ?? randomUUID();
    const estimatedInput = this.estimateInputTokens(params.messages);
    const route = this.llm.pickRoute(
      params.task,
      { estimatedInputTokens: estimatedInput },
      {
        modelId: params.ctx.modelId,
        projectDefaultModelId: params.ctx.projectDefaultModelId,
      },
    );
    const maxOut =
      params.maxOutputTokens ??
      this.pricing.getPrice(route.model).maxOutputTokens;
    const reserve = this.pricing.estimateCredits({
      model: route.model,
      estimatedInputTokens: estimatedInput,
      maxOutputTokens: maxOut,
    });

    const wrapped = await this.credits.withCredits(
      {
        userId: params.ctx.userId,
        action: params.action,
        reserveAmount: reserve,
        requestId,
        projectId: params.projectId,
      },
      async () => {
        const res = await this.llm.chat({
          task: params.task,
          messages: params.messages,
          temperature: params.temperature,
          jsonMode: params.jsonMode,
          maxOutputTokens: maxOut,
          estimatedInputTokens: estimatedInput,
          overrideModel: route.model,
        });
        return { content: res.content, usage: res.usage };
      },
    );

    return {
      content: wrapped.result.content,
      meta: {
        creditsCharged: wrapped.creditsCharged,
        balanceAfter: wrapped.balanceAfter,
      },
    };
  }

  private estimateInputTokens(messages: LlmMessage[]): number {
    let chars = 0;
    for (const m of messages) {
      if (typeof m.content === 'string') chars += m.content.length;
      else {
        for (const p of m.content) {
          if (p.type === 'text') chars += p.text.length;
          else chars += 1500;
        }
      }
    }
    return Math.max(1, Math.ceil(chars / 4));
  }

  // ──────────────────────────────────────────────────────────────
  // 1. SCHEMA EXTRACTION — Parse generated files into components
  // ──────────────────────────────────────────────────────────────

  async extractComponentSchema(
    projectId: string,
    files: Record<string, string>,
    executionPlan: Record<string, any> | undefined,
    ctx: PatchCallContext,
  ): Promise<{ schemas: ComponentSchemaDto[]; meta: PatchCreditMeta }> {
    this.logger.log(
      `Extracting component schema for project ${projectId} (${Object.keys(files).length} files)`,
    );

    const project = await this.projectModel.findById(projectId);
    if (!project) throw new NotFoundException('Project not found');

    const fileSummary = Object.entries(files)
      .map(([path, content]) => {
        const truncated =
          content.length > 500 ? content.substring(0, 500) + '...' : content;
        return `FILE: ${path}\n${truncated}`;
      })
      .join('\n\n---\n\n');

    const prompt = `Analyze the following generated React project files and extract a structured component schema.

For each significant component/page/layout/utility file, extract:
- componentId: A unique kebab-case ID (e.g., "hero-section", "nav-bar", "home-page")
- type: One of "page", "component", "layout", "hook", "utility", "config", "style"
- name: Human-readable name (e.g., "Hero Section", "Navigation Bar")
- description: Brief description of what this component does
- pageName: If this is a component used within a specific page, which page (null if shared)
- filePath: The exact file path from the project
- dependencies: Array of other componentIds this depends on
- props: Key properties/settings that can be patched (e.g., { "title": "Welcome", "backgroundColor": "#ffffff" })
- styles: Key style properties (e.g., { "background": "blue", "textColor": "white" })
- content: Text/media content (e.g., { "heading": "Welcome to our app", "description": "..." })

${executionPlan ? `\nExecution Plan Context:\n${JSON.stringify(executionPlan, null, 2).substring(0, 2000)}` : ''}

FILES TO ANALYZE:
${fileSummary}

IMPORTANT:
- Skip node_modules, config files like vite.config, tsconfig, etc.
- Focus on .jsx, .tsx, .css files that represent UI components
- Extract meaningful patchable properties from the actual code
- For styles, extract colors, backgrounds, font sizes, etc.
- For content, extract headings, descriptions, button text, etc.

Respond with ONLY a JSON array:
[
  {
    "componentId": "string",
    "type": "page|component|layout|hook|utility|config|style",
    "name": "string",
    "description": "string",
    "pageName": "string|null",
    "filePath": "string",
    "dependencies": ["string"],
    "props": {},
    "styles": {},
    "content": {}
  }
]`;

    try {
      const { content, meta } = await this.meteredChat({
        ctx,
        action: 'schema_extract',
        task: 'extract',
        projectId,
        messages: [
          {
            role: 'system',
            content:
              'You are a React code analyzer. Extract structured component schemas from generated code. Always respond with valid JSON arrays.',
          },
          { role: 'user', content: prompt },
        ],
        temperature: 0.3,
        jsonMode: true,
        maxOutputTokens: 8000,
      });

      if (!content) throw new Error('No response from AI');

      interface ParsedComponent {
        componentId: string;
        type?: string;
        name: string;
        description?: string;
        pageName?: string | null;
        filePath: string;
        dependencies?: string[];
        props?: Record<string, unknown>;
        styles?: Record<string, unknown>;
        layout?: Record<string, unknown>;
        content?: Record<string, unknown>;
      }

      let parsed: unknown = JSON.parse(content);
      if (!Array.isArray(parsed)) {
        const obj = parsed as Record<string, unknown>;
        parsed = obj.components || obj.schemas || Object.values(obj)[0];
      }
      if (!Array.isArray(parsed)) {
        throw new Error('Invalid AI response: expected an array of components');
      }
      const components = parsed as ParsedComponent[];

      await this.componentSchemaModel.deleteMany({ projectId });

      const schemas: ComponentSchema[] = [];
      for (const component of components) {
        const schema = await this.componentSchemaModel.create({
          projectId,
          componentId: component.componentId,
          type: component.type || ComponentType.COMPONENT,
          name: component.name,
          description: component.description,
          pageName: component.pageName || undefined,
          filePath: component.filePath,
          dependencies: component.dependencies || [],
          props: component.props || {},
          styles: component.styles || {},
          layout: component.layout || {},
          content: component.content || {},
          generatedCode: files[component.filePath] || undefined,
          version: 1,
          versionHistory: [],
        });
        schemas.push(schema);
      }

      await this.projectModel.findByIdAndUpdate(projectId, {
        $set: {
          componentSchemaExtracted: true,
          latestSnapshotVersion: 0,
        },
      });

      await this.createSnapshot(
        projectId,
        'Initial component schema extraction',
      );

      this.logger.log(
        `Extracted ${schemas.length} component schemas for project ${projectId}`,
      );

      return {
        schemas: schemas.map((s) =>
          plainToInstance(ComponentSchemaDto, s.toJSON()),
        ),
        meta,
      };
    } catch (error) {
      this.logger.error('Error extracting component schema:', error);
      throw new BadRequestException(
        `Failed to extract component schema: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  // ──────────────────────────────────────────────────────────────
  // 2. SNAPSHOTS
  // ──────────────────────────────────────────────────────────────

  async createSnapshot(
    projectId: string,
    commitMessage?: string,
  ): Promise<number> {
    const latestSnapshot = await this.projectSnapshotModel
      .findOne({ projectId })
      .sort({ snapshotVersion: -1 })
      .lean();

    const newVersion = (latestSnapshot?.snapshotVersion || 0) + 1;

    const schemas = await this.componentSchemaModel.find({ projectId }).lean();

    const componentSnapshots: ComponentSnapshot[] = schemas.map((s) => ({
      componentId: s.componentId,
      type: s.type,
      name: s.name,
      filePath: s.filePath,
      version: s.version,
      props: s.props,
      styles: s.styles,
      layout: s.layout,
      content: s.content,
      generatedCode: s.generatedCode,
    }));

    await this.projectSnapshotModel.create({
      projectId,
      snapshotVersion: newVersion,
      componentSchemas: componentSnapshots,
      commitMessage,
    });

    await this.projectModel.findByIdAndUpdate(projectId, {
      $set: { latestSnapshotVersion: newVersion },
    });

    this.logger.log(`Created snapshot v${newVersion} for project ${projectId}`);

    return newVersion;
  }

  // ──────────────────────────────────────────────────────────────
  // 3. ROLLBACK
  // ──────────────────────────────────────────────────────────────

  async rollbackComponent(
    projectId: string,
    componentId: string,
    targetVersion: number,
  ): Promise<{ regeneratedFiles: Record<string, string> }> {
    const schema = await this.componentSchemaModel.findOne({
      projectId,
      componentId,
    });

    if (!schema) throw new NotFoundException('Component not found');

    const versionEntry = schema.versionHistory.find(
      (v) => v.version === targetVersion,
    );

    if (!versionEntry) {
      throw new BadRequestException(
        `Version ${targetVersion} not found in history`,
      );
    }

    const currentVersion: ComponentVersion = {
      version: schema.version,
      props: { ...schema.props },
      styles: { ...schema.styles },
      layout: { ...schema.layout },
      content: { ...schema.content },
      generatedCode: schema.generatedCode,
      commitMessage: `Before rollback to v${targetVersion}`,
      createdAt: new Date(),
    };

    schema.props = versionEntry.props;
    schema.styles = versionEntry.styles;
    schema.layout = versionEntry.layout;
    schema.content = versionEntry.content;
    schema.generatedCode = versionEntry.generatedCode;
    schema.version += 1;
    schema.versionHistory = [...schema.versionHistory, currentVersion];
    schema.markModified('props');
    schema.markModified('styles');
    schema.markModified('layout');
    schema.markModified('content');
    schema.markModified('versionHistory');
    await schema.save();

    const regeneratedFiles: Record<string, string> = {};
    if (schema.generatedCode) {
      regeneratedFiles[schema.filePath] = schema.generatedCode;
    }

    await this.createSnapshot(
      projectId,
      `Rolled back ${componentId} to v${targetVersion}`,
    );

    return { regeneratedFiles };
  }

  async rollbackProject(
    projectId: string,
    targetSnapshotVersion: number,
  ): Promise<{ regeneratedFiles: Record<string, string> }> {
    const snapshot = await this.projectSnapshotModel.findOne({
      projectId,
      snapshotVersion: targetSnapshotVersion,
    });

    if (!snapshot) {
      throw new NotFoundException(
        `Snapshot v${targetSnapshotVersion} not found`,
      );
    }

    await this.createSnapshot(
      projectId,
      `Before rollback to snapshot v${targetSnapshotVersion}`,
    );

    await this.componentSchemaModel.deleteMany({ projectId });

    const regeneratedFiles: Record<string, string> = {};

    for (const cs of snapshot.componentSchemas) {
      await this.componentSchemaModel.create({
        projectId,
        componentId: cs.componentId,
        type: cs.type,
        name: cs.name,
        filePath: cs.filePath,
        version: cs.version,
        props: cs.props,
        styles: cs.styles,
        layout: cs.layout,
        content: cs.content,
        generatedCode: cs.generatedCode,
        versionHistory: [],
      });

      if (cs.generatedCode) {
        regeneratedFiles[cs.filePath] = cs.generatedCode;
      }
    }

    this.logger.log(
      `Rolled back project ${projectId} to snapshot v${targetSnapshotVersion}`,
    );

    return { regeneratedFiles };
  }

  async diffSnapshotAgainstCurrent(
    projectId: string,
    targetSnapshotVersion: number,
  ): Promise<{
    snapshotVersion: number;
    files: Array<{
      filePath: string;
      before: string;
      after: string;
      status: 'added' | 'modified' | 'deleted' | 'unchanged';
    }>;
  }> {
    const snapshot = await this.projectSnapshotModel.findOne({
      projectId,
      snapshotVersion: targetSnapshotVersion,
    });
    if (!snapshot) {
      throw new NotFoundException(
        `Snapshot v${targetSnapshotVersion} not found`,
      );
    }

    const snapshotFiles: Record<string, string> = {};
    for (const cs of snapshot.componentSchemas) {
      if (cs.generatedCode != null) {
        snapshotFiles[cs.filePath] = cs.generatedCode;
      }
    }

    const currentSchemas = await this.componentSchemaModel
      .find({ projectId })
      .lean();
    const currentFiles: Record<string, string> = {};
    for (const cs of currentSchemas) {
      if (cs.generatedCode != null) {
        currentFiles[cs.filePath] = cs.generatedCode;
      }
    }

    const allPaths = Array.from(
      new Set([...Object.keys(snapshotFiles), ...Object.keys(currentFiles)]),
    ).sort();

    const files = allPaths.map((filePath) => {
      const before = snapshotFiles[filePath] ?? '';
      const after = currentFiles[filePath] ?? '';
      let status: 'added' | 'modified' | 'deleted' | 'unchanged';
      if (!(filePath in snapshotFiles)) status = 'added';
      else if (!(filePath in currentFiles)) status = 'deleted';
      else if (before === after) status = 'unchanged';
      else status = 'modified';
      return { filePath, before, after, status };
    });

    return { snapshotVersion: targetSnapshotVersion, files };
  }

  async revertFilesToSnapshot(
    projectId: string,
    targetSnapshotVersion: number,
    filePaths: string[],
  ): Promise<{
    snapshotVersion: number;
    revertedFiles: string[];
    deletedFiles: string[];
    regeneratedFiles: Record<string, string>;
  }> {
    if (!Array.isArray(filePaths) || filePaths.length === 0) {
      throw new BadRequestException(
        'filePaths must be a non-empty string array',
      );
    }
    const snapshot = await this.projectSnapshotModel.findOne({
      projectId,
      snapshotVersion: targetSnapshotVersion,
    });
    if (!snapshot) {
      throw new NotFoundException(
        `Snapshot v${targetSnapshotVersion} not found`,
      );
    }

    await this.createSnapshot(
      projectId,
      `Before partial revert from v${targetSnapshotVersion} (${filePaths.length} files)`,
    );

    const targetByPath = new Map<string, ComponentSnapshot>();
    for (const cs of snapshot.componentSchemas) {
      targetByPath.set(cs.filePath, cs);
    }

    const reverted: string[] = [];
    const deleted: string[] = [];

    for (const filePath of filePaths) {
      const target = targetByPath.get(filePath);
      if (!target) {
        const removed = await this.componentSchemaModel.deleteOne({
          projectId,
          filePath,
        });
        if (removed.deletedCount && removed.deletedCount > 0) {
          deleted.push(filePath);
        }
        continue;
      }

      await this.componentSchemaModel.updateOne(
        { projectId, filePath },
        {
          $set: {
            componentId: target.componentId,
            type: target.type,
            name: target.name,
            filePath: target.filePath,
            version: target.version,
            props: target.props,
            styles: target.styles,
            layout: target.layout,
            content: target.content,
            generatedCode: target.generatedCode,
          },
          $setOnInsert: {
            projectId,
            versionHistory: [],
          },
        },
        { upsert: true },
      );
      reverted.push(filePath);
    }

    const remaining = await this.componentSchemaModel
      .find({ projectId })
      .lean();
    const regeneratedFiles: Record<string, string> = {};
    for (const cs of remaining) {
      if (cs.generatedCode != null) {
        regeneratedFiles[cs.filePath] = cs.generatedCode;
      }
    }

    this.logger.log(
      `Partial revert on ${projectId}: reverted=${reverted.length} deleted=${deleted.length}`,
    );

    return {
      snapshotVersion: targetSnapshotVersion,
      revertedFiles: reverted,
      deletedFiles: deleted,
      regeneratedFiles,
    };
  }

  // ──────────────────────────────────────────────────────────────
  // 4. QUERY HELPERS
  // ──────────────────────────────────────────────────────────────

  async getComponentsByProject(
    projectId: string,
  ): Promise<ComponentSchemaDto[]> {
    const schemas = await this.componentSchemaModel.find({ projectId }).lean();
    return schemas.map((s) => plainToInstance(ComponentSchemaDto, s));
  }

  async getComponentVersions(
    projectId: string,
    componentId: string,
  ): Promise<ComponentVersion[]> {
    const schema = await this.componentSchemaModel.findOne({
      projectId,
      componentId,
    });

    if (!schema) throw new NotFoundException('Component not found');

    const currentVersion: ComponentVersion = {
      version: schema.version,
      props: schema.props,
      styles: schema.styles,
      layout: schema.layout,
      content: schema.content,
      generatedCode: schema.generatedCode,
      commitMessage: 'Current version',
      createdAt: new Date(),
    };

    return [...schema.versionHistory, currentVersion];
  }

  async getSnapshots(projectId: string) {
    return this.projectSnapshotModel
      .find({ projectId })
      .select('snapshotVersion commitMessage createdAt')
      .sort({ snapshotVersion: -1 })
      .lean();
  }

  // ──────────────────────────────────────────────────────────────
  // 5. TEMPLATE SEEDING
  // ──────────────────────────────────────────────────────────────

  async seedComponentsFromTemplate(
    projectId: string,
    files: Record<string, string>,
  ): Promise<{ count: number }> {
    await this.componentSchemaModel.deleteMany({ projectId });

    const docs = Object.entries(files).map(([filePath, generatedCode]) => ({
      projectId,
      componentId: this.generateComponentId(filePath),
      type: this.inferComponentType(filePath),
      name: this.inferNameFromPath(filePath),
      filePath,
      dependencies: [],
      props: {},
      styles: {},
      layout: {},
      content: {},
      generatedCode,
      version: 1,
      versionHistory: [],
    }));

    if (docs.length > 0) {
      await this.componentSchemaModel.insertMany(docs, { ordered: false });
    }

    await this.projectModel.findByIdAndUpdate(projectId, {
      $set: {
        componentSchemaExtracted: true,
        latestSnapshotVersion: 0,
      },
    });

    this.logger.log(
      `Seeded ${docs.length} component schemas for project ${projectId} from template`,
    );

    return { count: docs.length };
  }

  // ──────────────────────────────────────────────────────────────
  // Private helpers
  // ──────────────────────────────────────────────────────────────

  private generateComponentId(filePath: string): string {
    const base = path
      .basename(filePath)
      .replace(/\.[^.]+$/, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
      .toLowerCase()
      .replace(/^-+|-+$/g, '');
    const hash = createHash('md5').update(filePath).digest('hex').slice(0, 6);
    return `${base || 'component'}-${hash}`;
  }

  private inferComponentType(filePath: string): ComponentType {
    const p = filePath.toLowerCase();
    if (p.includes('/pages/') || p.includes('/page/'))
      return ComponentType.PAGE;
    if (p.includes('/hooks/') || /\/use[A-Z]/.test(filePath))
      return ComponentType.HOOK;
    if (p.includes('/layouts/') || p.includes('/layout/'))
      return ComponentType.LAYOUT;
    if (p.includes('/utils/') || p.includes('/helpers/') || p.includes('/lib/'))
      return ComponentType.UTILITY;
    if (p.endsWith('.css') || p.endsWith('.scss')) return ComponentType.STYLE;
    if (p.includes('config') || p.endsWith('.json'))
      return ComponentType.CONFIG;
    return ComponentType.COMPONENT;
  }

  private inferNameFromPath(filePath: string): string {
    const stem = path.basename(filePath).replace(/\.[^.]+$/, '');
    const spaced = stem
      .replace(/[_-]+/g, ' ')
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .trim();
    return spaced
      .split(/\s+/)
      .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
      .join(' ');
  }
}
