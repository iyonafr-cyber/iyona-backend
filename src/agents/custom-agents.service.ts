import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import { AgentsService, AgentSummary } from './agents.service';
import {
  CustomAgent,
  CustomAgentDocument,
} from './entities/custom-agent.entity';
import {
  CreateCustomAgentDto,
  UpdateCustomAgentDto,
} from './dto/custom-agent.dto';

/**
 * Persistence + rules for user-defined specialists ("custom agents").
 *
 * These live in the `custom_agents` collection, one row per (userId, slug).
 * They surface in the same `/ai/agents` listing as built-ins and resolve in
 * chat the same way — the difference is only where the instruction body
 * comes from (Mongo vs. a bundled markdown file).
 */
@Injectable()
export class CustomAgentsService {
  constructor(
    @InjectModel(CustomAgent.name)
    private readonly model: Model<CustomAgentDocument>,
    private readonly builtIns: AgentsService,
  ) {}

  /** Lowercased slugs of the built-in agents — reserved, cannot be reused. */
  private reservedSlugs(): Set<string> {
    return new Set(this.builtIns.list().map((a) => a.slug));
  }

  /** Summaries for a user's specialists, shaped like built-in agents. */
  async listForUser(userId: string): Promise<AgentSummary[]> {
    const rows = await this.model
      .find({ userId: new Types.ObjectId(userId) })
      .sort({ name: 1 })
      .lean()
      .exec();
    return rows.map((r) => this.toSummary(r));
  }

  /** Full document (incl. instructions) for the owner, or null. */
  async getForUser(
    userId: string,
    slug: string,
  ): Promise<CustomAgentDocument | null> {
    if (!slug) return null;
    return this.model
      .findOne({
        userId: new Types.ObjectId(userId),
        slug: slug.trim().toLowerCase(),
      })
      .exec();
  }

  /** Full detail (summary + instructions) for the owner, or null. */
  async detailForUser(
    userId: string,
    slug: string,
  ): Promise<(AgentSummary & { instructions: string }) | null> {
    const doc = await this.getForUser(userId, slug);
    if (!doc) return null;
    return { ...this.toSummary(doc), instructions: doc.instructions };
  }

  /** Instructions body for chat resolution, or null when not found. */
  async getInstructions(
    userId: string,
    slug: string | undefined | null,
  ): Promise<string | null> {
    if (!slug) return null;
    const row = await this.model
      .findOne({
        userId: new Types.ObjectId(userId),
        slug: slug.trim().toLowerCase(),
      })
      .select('instructions')
      .lean()
      .exec();
    return row?.instructions ?? null;
  }

  async create(
    userId: string,
    dto: CreateCustomAgentDto,
  ): Promise<AgentSummary> {
    const slug = this.normalizeSlug(dto.slug || this.slugify(dto.name));
    if (!slug) {
      throw new BadRequestException(
        'Could not derive a valid slug from the name; please provide one.',
      );
    }
    if (this.reservedSlugs().has(slug)) {
      throw new ConflictException(
        `"${slug}" is a built-in specialist and cannot be reused.`,
      );
    }
    const uid = new Types.ObjectId(userId);
    const existing = await this.model.exists({ userId: uid, slug });
    if (existing) {
      throw new ConflictException(
        `You already have a specialist with the slug "${slug}".`,
      );
    }
    const doc = await this.model.create({
      userId: uid,
      slug,
      name: dto.name.trim(),
      description: dto.description?.trim() ?? '',
      icon: dto.icon?.trim() || 'sparkles',
      instructions: dto.instructions,
    });
    return this.toSummary(doc);
  }

  async update(
    userId: string,
    slug: string,
    dto: UpdateCustomAgentDto,
  ): Promise<AgentSummary> {
    const doc = await this.getForUser(userId, slug);
    if (!doc) throw new NotFoundException('Specialist not found.');
    if (dto.name !== undefined) doc.name = dto.name.trim();
    if (dto.description !== undefined) doc.description = dto.description.trim();
    if (dto.icon !== undefined) doc.icon = dto.icon.trim() || 'sparkles';
    if (dto.instructions !== undefined) doc.instructions = dto.instructions;
    await doc.save();
    return this.toSummary(doc);
  }

  async remove(userId: string, slug: string): Promise<void> {
    const res = await this.model
      .deleteOne({
        userId: new Types.ObjectId(userId),
        slug: slug.trim().toLowerCase(),
      })
      .exec();
    if (res.deletedCount === 0) {
      throw new NotFoundException('Specialist not found.');
    }
  }

  private toSummary(
    r: Pick<CustomAgent, 'slug' | 'name' | 'description' | 'icon'>,
  ): AgentSummary {
    return {
      slug: r.slug,
      name: r.name,
      description: r.description ?? '',
      icon: r.icon || 'sparkles',
      custom: true,
    };
  }

  private normalizeSlug(slug: string): string {
    return slug.trim().toLowerCase();
  }

  /** Turn a display name into a command-safe slug. */
  private slugify(name: string): string {
    return name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64);
  }
}
