import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join, resolve } from 'path';

export interface AgentSummary {
  slug: string;
  name: string;
  description: string;
  icon?: string;
  /**
   * Optional glob list describing which paths this agent focuses on.
   * Surfaced to the SPA so it can highlight relevant tree nodes when
   * a slash-command is active.
   */
  editable?: string[];
  /**
   * True for user-defined specialists (backed by the `custom_agents`
   * collection), false/undefined for built-in markdown agents. Lets the
   * SPA render an "edit / delete" affordance only on the user's own ones.
   */
  custom?: boolean;
}

export interface Agent extends AgentSummary {
  body: string;
}

/**
 * Loads markdown-defined agents from `src/agents/*.md` (or `dist/agents/*.md`
 * once compiled — see the assets entry in `nest-cli.json`). Each file uses
 * a tiny YAML-style frontmatter block delimited by `---` lines:
 *
 *   ---
 *   slug: designer
 *   name: Designer
 *   description: ...
 *   icon: paintbrush
 *   ---
 *   <body — used as the system prompt>
 *
 * The body is stored verbatim and prepended as a `system` LlmMessage when
 * the matching slash command (e.g. `/designer`) is invoked from the UI.
 */
@Injectable()
export class AgentsService implements OnModuleInit {
  private readonly logger = new Logger(AgentsService.name);
  private readonly agents = new Map<string, Agent>();

  onModuleInit(): void {
    const dir = this.resolveAgentsDir();
    if (!dir) {
      this.logger.warn(
        'No agents directory found; slash-command agents disabled',
      );
      return;
    }

    const files = readdirSync(dir).filter((f) => f.endsWith('.md'));
    for (const file of files) {
      try {
        const raw = readFileSync(join(dir, file), 'utf8');
        const agent = this.parseAgent(raw, file);
        if (agent) this.agents.set(agent.slug, agent);
      } catch (err) {
        this.logger.error(`Failed to load agent file ${file}`, err as Error);
      }
    }

    this.logger.log(
      `Loaded ${this.agents.size} agent(s): ${[...this.agents.keys()].join(', ') || '(none)'}`,
    );
  }

  list(): AgentSummary[] {
    return [...this.agents.values()]
      .map((agent): AgentSummary => {
        const { body, ...summary } = agent;
        void body;
        return summary;
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Returns the agent's editable glob list, or undefined when the agent
   * slug is unknown or has no `editable:` frontmatter.
   */
  getEditableScopes(slug: string | undefined | null): string[] | undefined {
    const agent = this.get(slug);
    return agent?.editable && agent.editable.length > 0
      ? agent.editable
      : undefined;
  }

  get(slug: string | undefined | null): Agent | null {
    if (!slug) return null;
    return this.agents.get(slug.trim().toLowerCase()) ?? null;
  }

  /**
   * Look in both the source tree (dev: `ts-node`/`nest start --watch`) and
   * the compiled tree (prod: `node dist/main.js`). The first one that
   * actually contains markdown wins.
   */
  private resolveAgentsDir(): string | null {
    const candidates = [
      resolve(__dirname),
      resolve(process.cwd(), 'dist', 'agents'),
      resolve(process.cwd(), 'src', 'agents'),
    ];
    for (const c of candidates) {
      if (existsSync(c) && readdirSync(c).some((f) => f.endsWith('.md'))) {
        return c;
      }
    }
    return null;
  }

  /**
   * Minimal frontmatter parser — supports both scalar `key: value`
   * lines AND simple multi-line list values:
   *
   *   editable:
   *     - src/components/**
   *     - src/pages/**
   *     - "!src/lib/cn.ts"
   *
   * Items inside a list may optionally be quoted (handy for globs that
   * start with `!`, which YAML would otherwise treat as a node tag).
   * Avoids pulling in `gray-matter`/`js-yaml` for a few-dozen-line need.
   */
  private parseAgent(raw: string, filename: string): Agent | null {
    // Strip a UTF-8 BOM if the file was saved by an editor that emits
    // one (notably VSCode on Windows or anything writing through
    // `iconv` with `addBOM`). Without this the `^---` anchor below
    // never matches and the agent silently disappears from the list.
    const cleaned = raw.replace(/^\uFEFF/, '');
    const match = cleaned.match(
      /^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?([\s\S]*)$/,
    );
    if (!match) {
      this.logger.warn(`Agent file ${filename} is missing frontmatter`);
      return null;
    }

    const [, frontmatter, body] = match;
    const scalars: Record<string, string> = {};
    const lists: Record<string, string[]> = {};
    const lines = frontmatter.split(/\r?\n/);

    let i = 0;
    while (i < lines.length) {
      const rawLine = lines[i];
      const trimmed = rawLine.trim();
      if (!trimmed || trimmed.startsWith('#')) {
        i++;
        continue;
      }
      const colon = trimmed.indexOf(':');
      if (colon === -1) {
        i++;
        continue;
      }
      const key = trimmed.slice(0, colon).trim();
      const inlineValue = trimmed.slice(colon + 1).trim();

      if (!key) {
        i++;
        continue;
      }

      if (inlineValue) {
        scalars[key] = unquote(inlineValue);
        i++;
        continue;
      }

      // Empty value → start of a list block. Eat any leading `- item`
      // lines (any indentation) until we hit something that isn't a
      // list item.
      const items: string[] = [];
      let j = i + 1;
      while (j < lines.length) {
        const nextRaw = lines[j];
        const nextTrim = nextRaw.trim();
        if (!nextTrim) {
          j++;
          continue;
        }
        if (!nextTrim.startsWith('- ')) break;
        items.push(unquote(nextTrim.slice(2).trim()));
        j++;
      }
      if (items.length > 0) lists[key] = items;
      i = j;
    }

    const slug = (scalars.slug || filename.replace(/\.md$/, '')).toLowerCase();
    const name = scalars.name || slug;
    const description = scalars.description || '';
    const icon = scalars.icon || undefined;
    const editable = lists.editable;
    const trimmedBody = body.trim();

    if (!trimmedBody) {
      this.logger.warn(`Agent ${slug} has empty body — skipping`);
      return null;
    }

    return { slug, name, description, icon, editable, body: trimmedBody };
  }
}

function unquote(v: string): string {
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    return v.slice(1, -1);
  }
  return v;
}
