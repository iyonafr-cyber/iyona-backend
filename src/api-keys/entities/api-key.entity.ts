import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { Document, Types } from 'mongoose';

export type ApiKeyScope =
  | 'projects:read'
  | 'projects:write'
  | 'webhooks:read'
  | 'webhooks:write'
  | 'admin';

/**
 * Org-scoped API key (E11).
 *
 * The raw key is shown to the user exactly once at creation time and
 * never persisted in plaintext. We store:
 *
 *   - `prefix`  : the first 8 chars of the raw key (display + lookup
 *                 short-circuit so we don't bcrypt-compare every key).
 *   - `keyHash` : SHA-256(rawKey + serverPepper). SHA is fine here
 *                 because the raw key is high-entropy (32 bytes).
 *
 * Authentication: caller sends `X-API-Key: jv_<prefix>_<rest>`. The
 * guard splits on `_`, looks up by `prefix`, then constant-time
 * compares the hash.
 */
@Schema({ timestamps: true, collection: 'api_keys' })
export class ApiKey {
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
  })
  createdBy!: Types.ObjectId;

  @Prop({ type: String, required: true, trim: true, maxlength: 80 })
  name!: string;

  /** First 8 chars of the raw key. Indexed for the hot lookup path. */
  @Prop({ type: String, required: true, index: true, unique: true })
  prefix!: string;

  /** SHA-256 hash of (rawKey + pepper). Never returned in API responses. */
  @Prop({ type: String, required: true })
  keyHash!: string;

  @Prop({
    type: [String],
    enum: [
      'projects:read',
      'projects:write',
      'webhooks:read',
      'webhooks:write',
      'admin',
    ],
    default: ['projects:read'],
  })
  scopes!: ApiKeyScope[];

  @Prop({ type: Date, default: null })
  expiresAt?: Date | null;

  @Prop({ type: Date, default: null })
  lastUsedAt?: Date | null;

  /** Soft-delete: revoked keys are kept for audit but rejected by the guard. */
  @Prop({ type: Boolean, default: false, index: true })
  revoked!: boolean;
}

export type ApiKeyDocument = ApiKey & Document;
export const ApiKeySchema = SchemaFactory.createForClass(ApiKey);
