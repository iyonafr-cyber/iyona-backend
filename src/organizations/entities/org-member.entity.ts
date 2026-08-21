import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { Document, Types } from 'mongoose';

export type OrgRole = 'owner' | 'admin' | 'member' | 'viewer';

/**
 * Organization membership. One row per (orgId, userId) pair; a user
 * can belong to many orgs. Roles follow a coarse RBAC scheme:
 *
 *   - owner   : billing + delete org + everything below
 *   - admin   : invite/remove members, manage settings
 *   - member  : create/edit projects
 *   - viewer  : read-only
 *
 * Owner role is enforced as exactly-one per org by the service layer
 * (transferring ownership rotates the row). The unique compound index
 * below prevents duplicate memberships.
 */
@Schema({ timestamps: true, collection: 'org_members' })
export class OrgMember {
  @Prop({
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Organization',
    required: true,
    index: true,
  })
  orgId!: Types.ObjectId;

  @Prop({
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  })
  userId!: Types.ObjectId;

  @Prop({
    type: String,
    enum: ['owner', 'admin', 'member', 'viewer'],
    default: 'member',
  })
  role!: OrgRole;

  /**
   * When the member was last active in this org (e.g. switched into
   * it). Lets us surface "stale member" reports to admins without an
   * extra audit query.
   */
  @Prop({ type: Date, default: null })
  lastActiveAt?: Date | null;
}

export type OrgMemberDocument = OrgMember & Document;
export const OrgMemberSchema = SchemaFactory.createForClass(OrgMember);
OrgMemberSchema.index({ orgId: 1, userId: 1 }, { unique: true });
