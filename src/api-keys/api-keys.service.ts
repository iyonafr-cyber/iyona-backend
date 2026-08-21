import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as crypto from 'crypto';
import { ApiKey, ApiKeyDocument, ApiKeyScope } from './entities/api-key.entity';
import { OrganizationsService } from '../organizations/organizations.service';

const RAW_KEY_BYTES = 24; // → 32 chars after base64url
const PEPPER = process.env.API_KEY_PEPPER || 'jarvis-default-pepper-CHANGEME';

export interface CreatedApiKey {
  _id: string;
  orgId: string;
  name: string;
  prefix: string;
  scopes: ApiKeyScope[];
  expiresAt: Date | null;
  createdAt: Date;
  /** Plaintext key — returned exactly once on creation. */
  rawKey: string;
}

export interface ApiKeyView {
  _id: string;
  orgId: string;
  name: string;
  prefix: string;
  scopes: ApiKeyScope[];
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  revoked: boolean;
  createdAt: Date;
}

/**
 * E11 — org-scoped API keys.
 *
 * Lookup flow during auth (see ApiKeyAuthGuard):
 *   1. Header `X-API-Key: jv_<prefix>_<rest>`
 *   2. Find by `prefix` (indexed, unique)
 *   3. SHA-256 the raw key + pepper, constant-time compare to keyHash
 *   4. Reject if revoked or expired; bump lastUsedAt async
 */
@Injectable()
export class ApiKeysService {
  private readonly logger = new Logger(ApiKeysService.name);

  constructor(
    @InjectModel(ApiKey.name) private readonly keyModel: Model<ApiKeyDocument>,
    private readonly orgsService: OrganizationsService,
  ) {}

  // ── Internal helpers ───────────────────────────────────────────

  private hashKey(rawKey: string): string {
    return crypto
      .createHash('sha256')
      .update(`${rawKey}${PEPPER}`)
      .digest('hex');
  }

  /** Generates "jv_" + 8-char prefix + "_" + 32-char body. */
  private generateRawKey(): { rawKey: string; prefix: string } {
    const prefix = crypto.randomBytes(6).toString('base64url').slice(0, 8);
    const body = crypto.randomBytes(RAW_KEY_BYTES).toString('base64url');
    return { rawKey: `jv_${prefix}_${body}`, prefix };
  }

  private toView(
    doc: ApiKeyDocument | (ApiKey & { _id: any; createdAt?: Date }),
  ): ApiKeyView {
    const d: any = doc;
    return {
      _id: String(d._id),
      orgId: String(d.orgId),
      name: d.name,
      prefix: d.prefix,
      scopes: d.scopes,
      expiresAt: d.expiresAt ? new Date(d.expiresAt) : null,
      lastUsedAt: d.lastUsedAt ? new Date(d.lastUsedAt) : null,
      revoked: d.revoked,
      createdAt: d.createdAt ? new Date(d.createdAt) : new Date(),
    };
  }

  // ── Public API ─────────────────────────────────────────────────

  async list(orgId: string, userId: string): Promise<ApiKeyView[]> {
    await this.orgsService.requireMembership(orgId, userId);
    const keys = await this.keyModel
      .find({ orgId: new Types.ObjectId(orgId) })
      .sort({ createdAt: -1 })
      .lean();
    return keys.map((k) => this.toView(k as any));
  }

  async create(
    orgId: string,
    userId: string,
    name: string,
    scopes: ApiKeyScope[],
    expiresAt?: Date | null,
  ): Promise<CreatedApiKey> {
    if (!name?.trim()) {
      throw new BadRequestException('API key name is required.');
    }
    if (!Array.isArray(scopes) || scopes.length === 0) {
      throw new BadRequestException('At least one scope is required.');
    }
    // Admin role required to create keys (audit / blast radius).
    await this.orgsService.requireRole(orgId, userId, 'admin');

    let attempt = 0;
    let raw: { rawKey: string; prefix: string };
    while (true) {
      raw = this.generateRawKey();
      const collision = await this.keyModel.exists({ prefix: raw.prefix });
      if (!collision) break;
      attempt++;
      if (attempt > 5) {
        throw new BadRequestException(
          'Could not allocate a unique API key prefix; please retry.',
        );
      }
    }

    const created = await this.keyModel.create({
      orgId: new Types.ObjectId(orgId),
      createdBy: new Types.ObjectId(userId),
      name: name.trim(),
      prefix: raw.prefix,
      keyHash: this.hashKey(raw.rawKey),
      scopes,
      expiresAt: expiresAt ?? null,
    });

    this.logger.log(
      `Created API key ${created._id} for org ${orgId} (scopes=${scopes.join(',')})`,
    );

    return {
      _id: String(created._id),
      orgId,
      name: created.name,
      prefix: created.prefix,
      scopes: created.scopes,
      expiresAt: created.expiresAt ?? null,
      createdAt: (created as any).createdAt,
      rawKey: raw.rawKey,
    };
  }

  async revoke(orgId: string, userId: string, keyId: string): Promise<void> {
    await this.orgsService.requireRole(orgId, userId, 'admin');
    if (!Types.ObjectId.isValid(keyId)) {
      throw new NotFoundException('API key not found');
    }
    const updated = await this.keyModel.findOneAndUpdate(
      { _id: new Types.ObjectId(keyId), orgId: new Types.ObjectId(orgId) },
      { $set: { revoked: true } },
      { new: true },
    );
    if (!updated) throw new NotFoundException('API key not found');
  }

  // ── Auth path (used by guard) ──────────────────────────────────

  /**
   * Verifies a raw API key. Returns the key document on success or null on
   * any kind of failure (we do NOT distinguish "wrong" from "revoked" from
   * "not found" to avoid timing oracles in error messages).
   */
  async verifyRawKey(rawKey: string): Promise<ApiKeyDocument | null> {
    if (typeof rawKey !== 'string' || !rawKey.startsWith('jv_')) return null;
    const parts = rawKey.split('_');
    if (parts.length < 3) return null;
    const prefix = parts[1];
    if (!prefix || prefix.length !== 8) return null;

    const keyDoc = await this.keyModel.findOne({ prefix }).exec();
    if (!keyDoc || keyDoc.revoked) return null;
    if (keyDoc.expiresAt && keyDoc.expiresAt.getTime() < Date.now())
      return null;

    const computed = this.hashKey(rawKey);
    const a = Buffer.from(computed, 'hex');
    const b = Buffer.from(keyDoc.keyHash, 'hex');
    if (a.length !== b.length) return null;
    if (!crypto.timingSafeEqual(a, b)) return null;

    // Best-effort lastUsedAt (don't block the request).
    setImmediate(() => {
      this.keyModel
        .updateOne({ _id: keyDoc._id }, { $set: { lastUsedAt: new Date() } })
        .catch(() => {
          /* ignore */
        });
    });

    return keyDoc;
  }
}
