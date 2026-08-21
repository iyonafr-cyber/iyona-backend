import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { Document, Types } from 'mongoose';

export type OrgPlan = 'free' | 'team_starter' | 'team_pro';

/**
 * Organization (a.k.a. workspace) — the unit of collaboration that
 * will own projects, billing, members, SSO, API keys, and webhooks
 * once the rest of the platform finishes migrating off the
 * single-user model (E8 → E9 → E10 → E11 → E12).
 *
 * Created in E8 with intentionally minimal fields. Per-seat billing
 * lives in E9 and will extend this entity with `seatCount`,
 * `stripeSubscriptionId`, etc. SSO + API keys + webhooks each get
 * their own collection that references `Organization._id`.
 *
 * For backwards compatibility we keep all existing user-scoped
 * billing on the User entity; an org has billing duplicated only
 * when E9 lands. Until then `plan` is informational (`'free'`).
 */
@Schema({ timestamps: true, collection: 'organizations' })
export class Organization {
  @Prop({ type: String, required: true, trim: true, maxlength: 80 })
  name!: string;

  /**
   * URL-safe slug used in routes and as the canonical org identifier
   * for API keys. Lowercased; uniqueness enforced via index below.
   */
  @Prop({
    type: String,
    required: true,
    trim: true,
    lowercase: true,
    maxlength: 60,
  })
  slug!: string;

  /**
   * Convenience pointer to the user who created the org. Owners are
   * also represented by an OrgMember row with role='owner'; this
   * field exists so we can answer "who owns this workspace?" without
   * an extra join.
   */
  @Prop({
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  })
  ownerId!: Types.ObjectId;

  /**
   * Personal workspaces are auto-created on first login (lazy
   * migration). Team workspaces are explicitly created by users.
   * The flag is purely informational — both kinds participate in
   * billing identically once E9 lands.
   */
  @Prop({ type: Boolean, default: false })
  isPersonal!: boolean;

  @Prop({
    type: String,
    enum: ['free', 'team_starter', 'team_pro'],
    default: 'free',
  })
  plan!: OrgPlan;

  /**
   * Per-org feature flags so we can ship Phase 2-4 epics dark and
   * enable per workspace (cross-cutting requirement in the roadmap).
   * Stored as a flat string array for cheap inclusion checks.
   */
  @Prop({ type: [String], default: [] })
  featureFlags!: string[];

  // ─── Reserved for E9 (per-seat billing) ─────────────────────────
  @Prop({ type: Number, default: 1 })
  seatCount!: number;

  @Prop({ type: String, default: null })
  stripeCustomerId?: string | null;

  @Prop({ type: String, default: null })
  stripeSubscriptionId?: string | null;

  // ─── E10 (SSO/SAML via WorkOS) ──────────────────────────────────
  /**
   * WorkOS connection id (e.g. `conn_01H...`). Set by an admin via
   * the SSO settings page after they finish the WorkOS admin portal
   * flow. When present, users with a matching ssoDomain land on the
   * org's IdP rather than the password form.
   */
  @Prop({ type: String, default: null })
  ssoConnectionId?: string | null;

  /**
   * Email domain this SSO connection covers (e.g. `acme.com`).
   * Lowercased; used to route logins to the right WorkOS connection.
   */
  @Prop({ type: String, default: null, lowercase: true, trim: true })
  ssoDomain?: string | null;

  /**
   * If true, members whose email matches `ssoDomain` MUST sign in via
   * SSO; password login is rejected. Off by default so admins can
   * test their connection before flipping the switch.
   */
  @Prop({ type: Boolean, default: false })
  ssoRequired!: boolean;
}

export type OrganizationDocument = Organization & Document;
export const OrganizationSchema = SchemaFactory.createForClass(Organization);
OrganizationSchema.index({ slug: 1 }, { unique: true });
