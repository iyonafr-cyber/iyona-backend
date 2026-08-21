import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';

export type AuditTargetType =
  | 'user'
  | 'project'
  | 'model'
  | 'credits'
  | 'system';

/**
 * Append-only log of every privileged mutation performed through the
 * `/admin/*` surface. Writes are invoked explicitly from each admin service
 * (no hidden interceptor) so the `before`/`after` snapshots capture the
 * exact state boundary the operator saw/created.
 */
@Schema({ timestamps: true, collection: 'admin_audit_logs' })
export class AdminAuditLog extends Document {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  })
  actorId: Types.ObjectId;

  @Prop({ type: String, required: true })
  actorEmail: string;

  /**
   * Dot-namespaced action identifier, e.g. `user.role.changed`,
   * `project.takedown`, `credits.adjusted`, `system.maintenance.enabled`.
   */
  @Prop({ type: String, required: true, index: true })
  action: string;

  @Prop({
    type: String,
    required: true,
    enum: ['user', 'project', 'model', 'credits', 'system'],
    index: true,
  })
  targetType: AuditTargetType;

  @Prop({ type: String, default: null, index: true })
  targetId: string | null;

  @Prop({ type: MongooseSchema.Types.Mixed, default: null })
  before: Record<string, unknown> | null;

  @Prop({ type: MongooseSchema.Types.Mixed, default: null })
  after: Record<string, unknown> | null;

  @Prop({ type: String, default: null })
  reason: string | null;

  @Prop({ type: String, default: null })
  ip: string | null;

  @Prop({ type: String, default: null })
  userAgent: string | null;
}

export const AdminAuditLogSchema = SchemaFactory.createForClass(AdminAuditLog);
AdminAuditLogSchema.index({ createdAt: -1 });
AdminAuditLogSchema.index({ actorId: 1, createdAt: -1 });
AdminAuditLogSchema.index({ targetType: 1, targetId: 1, createdAt: -1 });
