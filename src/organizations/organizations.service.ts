import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  Organization,
  OrganizationDocument,
} from './entities/organization.entity';
import {
  OrgMember,
  OrgMemberDocument,
  type OrgRole,
} from './entities/org-member.entity';
import { User } from '../user/entities/user.entity';
import {
  CreateOrganizationDto,
  InviteMemberDto,
  UpdateMemberRoleDto,
  UpdateOrganizationDto,
} from './dto/organization.dto';

const ROLE_RANK: Record<OrgRole, number> = {
  viewer: 0,
  member: 1,
  admin: 2,
  owner: 3,
};

/**
 * Organization & membership management (E8).
 *
 * Designed for lazy migration: existing single-user accounts get a
 * personal org auto-created on first call to `ensurePersonalOrg`.
 * Existing billing fields stay on `User` for now — E9 will move them
 * onto `Organization` and run the data migration.
 */
@Injectable()
export class OrganizationsService {
  private readonly logger = new Logger(OrganizationsService.name);

  constructor(
    @InjectModel(Organization.name)
    private readonly orgModel: Model<OrganizationDocument>,
    @InjectModel(OrgMember.name)
    private readonly memberModel: Model<OrgMemberDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<User>,
    private readonly moduleRef: ModuleRef,
  ) {}

  /**
   * Membership-changed hook (E9). The seat count is mirrored on the org
   * document so the admin UI never needs a Stripe round-trip, and we
   * fire-and-forget a Stripe sync so the subscription quantity tracks
   * the team size. The lazy `ModuleRef` lookup avoids a circular import
   * with `OrgBillingService`.
   */
  private async refreshSeatCount(orgId: string): Promise<number> {
    const count = await this.memberModel.countDocuments({
      orgId: new Types.ObjectId(orgId),
    });
    await this.orgModel.updateOne(
      { _id: new Types.ObjectId(orgId) },
      { $set: { seatCount: count } },
    );
    setImmediate(() => {
      void this.syncSeatsBestEffort(orgId);
    });
    return count;
  }

  private async syncSeatsBestEffort(orgId: string): Promise<void> {
    try {
      const billing = this.moduleRef.get(
        // Lazy-import so we never hold a hard symbol reference at construct
        // time; falls back silently when billing module isn't loaded (tests,
        // self-hosted without Stripe, etc.).
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('./org-billing.service').OrgBillingService,
        { strict: false },
      );
      if (billing?.syncSeatsToStripe) {
        await billing.syncSeatsToStripe(orgId);
      }
    } catch (err) {
      this.logger.debug(
        `Skip Stripe seat sync for ${orgId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  // ────────────────────────────────────────────────────────────────
  // Lazy provisioning
  // ────────────────────────────────────────────────────────────────

  /**
   * Idempotently provisions a "Personal" org for a user that doesn't
   * already have one, and sets `currentOrgId` if missing. Safe to
   * call on every authenticated request.
   */
  async ensurePersonalOrg(userId: string): Promise<OrganizationDocument> {
    const userObjId = new Types.ObjectId(userId);
    const existingOwn = await this.orgModel
      .findOne({ ownerId: userObjId, isPersonal: true })
      .exec();
    if (existingOwn) {
      await this.userModel.updateOne(
        { _id: userObjId, currentOrgId: { $in: [null, undefined] } },
        { $set: { currentOrgId: existingOwn._id } },
      );
      return existingOwn;
    }

    const user = await this.userModel.findById(userObjId).lean();
    if (!user) throw new NotFoundException('User not found');

    const baseSlug = await this.allocateSlug(
      (user.email?.split('@')[0] ?? `user-${userId.slice(-6)}`).toLowerCase(),
    );

    const created = await this.orgModel.create({
      name: 'Personal',
      slug: baseSlug,
      ownerId: userObjId,
      isPersonal: true,
      plan: 'free',
      seatCount: 1,
    });

    await this.memberModel.create({
      orgId: created._id,
      userId: userObjId,
      role: 'owner',
      lastActiveAt: new Date(),
    });

    await this.userModel.updateOne(
      { _id: userObjId },
      { $set: { currentOrgId: created._id } },
    );

    this.logger.log(`Provisioned personal org ${created._id} for ${userId}`);
    return created;
  }

  // ────────────────────────────────────────────────────────────────
  // CRUD
  // ────────────────────────────────────────────────────────────────

  async create(
    userId: string,
    dto: CreateOrganizationDto,
  ): Promise<OrganizationDocument> {
    const userObjId = new Types.ObjectId(userId);
    const slug = await this.allocateSlug(dto.slug ?? this.slugify(dto.name));
    const org = await this.orgModel.create({
      name: dto.name.trim(),
      slug,
      ownerId: userObjId,
      isPersonal: false,
      plan: 'free',
      seatCount: 1,
    });
    await this.memberModel.create({
      orgId: org._id,
      userId: userObjId,
      role: 'owner',
      lastActiveAt: new Date(),
    });
    return org;
  }

  async update(
    orgId: string,
    userId: string,
    dto: UpdateOrganizationDto,
  ): Promise<OrganizationDocument> {
    await this.assertRole(orgId, userId, 'admin');
    const updates: Partial<Organization> = {};
    if (dto.name != null) updates.name = dto.name.trim();
    if (dto.featureFlags != null) updates.featureFlags = dto.featureFlags;
    const updated = await this.orgModel
      .findByIdAndUpdate(orgId, { $set: updates }, { new: true })
      .exec();
    if (!updated) throw new NotFoundException('Organization not found');
    return updated;
  }

  async deleteOrg(orgId: string, userId: string): Promise<void> {
    const org = await this.assertRole(orgId, userId, 'owner');
    if (org.isPersonal) {
      throw new BadRequestException('Personal workspaces cannot be deleted.');
    }
    await this.memberModel.deleteMany({ orgId: org._id });
    await this.orgModel.deleteOne({ _id: org._id });
  }

  // ────────────────────────────────────────────────────────────────
  // Membership
  // ────────────────────────────────────────────────────────────────

  async listMyOrgs(
    userId: string,
  ): Promise<
    Array<Organization & { _id: any; myRole: OrgRole; memberCount: number }>
  > {
    const userObjId = new Types.ObjectId(userId);
    const memberships = await this.memberModel
      .find({ userId: userObjId })
      .lean();
    if (memberships.length === 0) {
      const personal = await this.ensurePersonalOrg(userId);
      return [
        {
          ...(personal.toObject() as Organization & { _id: any }),
          myRole: 'owner' as OrgRole,
          memberCount: 1,
        },
      ];
    }
    const orgIds = memberships.map((m) => m.orgId);
    const orgs = await this.orgModel.find({ _id: { $in: orgIds } }).lean();
    const memberCounts = await this.memberModel.aggregate<{
      _id: Types.ObjectId;
      count: number;
    }>([
      { $match: { orgId: { $in: orgIds } } },
      { $group: { _id: '$orgId', count: { $sum: 1 } } },
    ]);
    const countByOrg = new Map(
      memberCounts.map((m) => [String(m._id), m.count]),
    );
    const roleByOrg = new Map(
      memberships.map((m) => [String(m.orgId), m.role]),
    );
    return orgs.map((o) => ({
      ...(o as Organization & { _id: any }),
      myRole: roleByOrg.get(String(o._id)) ?? 'member',
      memberCount: countByOrg.get(String(o._id)) ?? 0,
    }));
  }

  async listMembers(
    orgId: string,
    userId: string,
  ): Promise<Array<OrgMember & { _id: any; email?: string }>> {
    await this.assertMembership(orgId, userId);
    const members = await this.memberModel
      .find({ orgId: new Types.ObjectId(orgId) })
      .lean();
    if (members.length === 0) return [];
    const userIds = members.map((m) => m.userId);
    const users = await this.userModel
      .find({ _id: { $in: userIds } })
      .select('email')
      .lean();
    const emailById = new Map(users.map((u) => [String(u._id), u.email]));
    return members.map((m) => ({
      ...(m as OrgMember & { _id: any }),
      email: emailById.get(String(m.userId)),
    }));
  }

  async invite(
    orgId: string,
    actingUserId: string,
    dto: InviteMemberDto,
  ): Promise<OrgMemberDocument> {
    await this.assertRole(orgId, actingUserId, 'admin');
    const target = await this.userModel
      .findOne({ email: dto.email.trim().toLowerCase() })
      .lean();
    if (!target) {
      // For now we only support inviting existing users. Email-based
      // invites with token acceptance ship in a follow-up.
      throw new NotFoundException(
        `No user with email ${dto.email}. Email-based invites with acceptance tokens are not yet supported.`,
      );
    }
    const orgObjId = new Types.ObjectId(orgId);
    const existing = await this.memberModel.findOne({
      orgId: orgObjId,
      userId: target._id,
    });
    if (existing) {
      throw new BadRequestException(
        'User is already a member of this organization.',
      );
    }
    const member = await this.memberModel.create({
      orgId: orgObjId,
      userId: target._id,
      role: dto.role,
    });
    await this.refreshSeatCount(orgId);
    return member;
  }

  async updateMemberRole(
    orgId: string,
    actingUserId: string,
    targetUserId: string,
    dto: UpdateMemberRoleDto,
  ): Promise<OrgMemberDocument> {
    await this.assertRole(orgId, actingUserId, 'admin');
    if (dto.role === 'owner') {
      // Transferring ownership rotates the existing owner down to
      // admin so we never end up with two owners.
      const orgObjId = new Types.ObjectId(orgId);
      await this.memberModel.updateMany(
        { orgId: orgObjId, role: 'owner' },
        { $set: { role: 'admin' } },
      );
      await this.orgModel.updateOne(
        { _id: orgObjId },
        { $set: { ownerId: new Types.ObjectId(targetUserId) } },
      );
    }
    const updated = await this.memberModel
      .findOneAndUpdate(
        {
          orgId: new Types.ObjectId(orgId),
          userId: new Types.ObjectId(targetUserId),
        },
        { $set: { role: dto.role } },
        { new: true },
      )
      .exec();
    if (!updated) throw new NotFoundException('Member not found');
    return updated;
  }

  async removeMember(
    orgId: string,
    actingUserId: string,
    targetUserId: string,
  ): Promise<void> {
    const target = await this.memberModel.findOne({
      orgId: new Types.ObjectId(orgId),
      userId: new Types.ObjectId(targetUserId),
    });
    if (!target) throw new NotFoundException('Member not found');
    if (target.role === 'owner') {
      throw new BadRequestException(
        'Transfer ownership to another member before removing the owner.',
      );
    }
    if (actingUserId !== targetUserId) {
      await this.assertRole(orgId, actingUserId, 'admin');
    }
    await this.memberModel.deleteOne({ _id: target._id });
    await this.refreshSeatCount(orgId);
  }

  // ────────────────────────────────────────────────────────────────
  // Switching
  // ────────────────────────────────────────────────────────────────

  async switchOrg(
    userId: string,
    orgId: string,
  ): Promise<OrganizationDocument> {
    const member = await this.memberModel.findOne({
      orgId: new Types.ObjectId(orgId),
      userId: new Types.ObjectId(userId),
    });
    if (!member) {
      throw new ForbiddenException(
        'You are not a member of this organization.',
      );
    }
    const org = await this.orgModel.findById(orgId);
    if (!org) throw new NotFoundException('Organization not found');
    await this.userModel.updateOne(
      { _id: new Types.ObjectId(userId) },
      { $set: { currentOrgId: org._id } },
    );
    member.lastActiveAt = new Date();
    await member.save();
    return org;
  }

  // ────────────────────────────────────────────────────────────────
  // Public helpers (used by other modules e.g. ApiKeys, Webhooks)
  // ────────────────────────────────────────────────────────────────

  /** Throws unless `userId` belongs to `orgId`; returns the membership. */
  async requireMembership(
    orgId: string,
    userId: string,
  ): Promise<OrgMemberDocument> {
    return this.assertMembership(orgId, userId);
  }

  /** Throws unless `userId` has `required` role or higher in `orgId`. */
  async requireRole(
    orgId: string,
    userId: string,
    required: OrgRole,
  ): Promise<OrganizationDocument> {
    return this.assertRole(orgId, userId, required);
  }

  /**
   * Fetch an org directly without a membership check. Used by callers that
   * have already authorized via a different mechanism (e.g. API key, webhook
   * signature) and just need the org payload.
   */
  async findOrgById(orgId: string): Promise<OrganizationDocument | null> {
    if (!Types.ObjectId.isValid(orgId)) return null;
    return this.orgModel.findById(orgId);
  }

  /**
   * Read the user's last-selected (or freshly-provisioned) active org id.
   * Returns null if no User row exists or `currentOrgId` was never set.
   */
  async getActiveOrgId(userId: string): Promise<string | null> {
    if (!Types.ObjectId.isValid(userId)) return null;
    const u = await this.userModel
      .findById(userId)
      .select('currentOrgId')
      .lean();
    return u?.currentOrgId ? String(u.currentOrgId) : null;
  }

  // ────────────────────────────────────────────────────────────────
  // Internals
  // ────────────────────────────────────────────────────────────────

  private async assertMembership(
    orgId: string,
    userId: string,
  ): Promise<OrgMemberDocument> {
    if (!Types.ObjectId.isValid(orgId)) {
      throw new NotFoundException('Organization not found');
    }
    const member = await this.memberModel.findOne({
      orgId: new Types.ObjectId(orgId),
      userId: new Types.ObjectId(userId),
    });
    if (!member) {
      throw new ForbiddenException('Not a member of this organization');
    }
    return member;
  }

  /** Throws unless the user has the requested role or higher. */
  private async assertRole(
    orgId: string,
    userId: string,
    required: OrgRole,
  ): Promise<OrganizationDocument> {
    const member = await this.assertMembership(orgId, userId);
    if (ROLE_RANK[member.role] < ROLE_RANK[required]) {
      throw new ForbiddenException(
        `Requires ${required} role; you are ${member.role}.`,
      );
    }
    const org = await this.orgModel.findById(orgId);
    if (!org) throw new NotFoundException('Organization not found');
    return org;
  }

  private slugify(input: string): string {
    return (
      input
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 50) || 'workspace'
    );
  }

  private async allocateSlug(base: string): Promise<string> {
    const cleaned = this.slugify(base);
    for (let i = 0; i < 50; i++) {
      const candidate = i === 0 ? cleaned : `${cleaned}-${i + 1}`;
      const exists = await this.orgModel.exists({ slug: candidate });
      if (!exists) return candidate;
    }
    return `${cleaned}-${Date.now().toString(36)}`;
  }
}
