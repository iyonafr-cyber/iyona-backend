import { Inject, Injectable } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { UserProjectDto } from './dto/user-project-dto.dto';
import { ProjectAccessRole } from './project-access.service';
import { withVercelProtectionBypass } from 'src/vercel/vercel-deployment-url.util';
import type { IEncryptionService } from 'src/encryption/interface/encryption.interface.service';

/**
 * Maps a `UserProject` entity/document to the wire-safe `UserProjectDto`.
 * Extracted from `ProjectsService` so every service that returns a project DTO
 * (workflow, secrets, public/remix, supabase, …) shares ONE mapper — and one
 * definition of which fields are secret.
 *
 * Two responsibilities that must never be skipped:
 *   1. Strip encrypted/secret + internal-only fields (`stripProjectSecrets`).
 *   2. Mask the Stripe secret key by access role (`maskStripeSecret`).
 */
@Injectable()
export class ProjectMapperService {
  constructor(
    @Inject('IEncryptionService')
    private readonly encryptionService: IEncryptionService,
  ) {}

  /**
   * Convert a UserProject document/plain object into a `UserProjectDto`,
   * replacing the encrypted `stripeSecretKey` (if any) with a safe masked form
   * derived from the *decrypted* value.
   *
   * The mask varies by access role:
   *   - owner     → `sk_****<last4>` (so the owner can verify their key)
   *   - non-owner → `sk_****` (no last-4 — collaborators must not identify it)
   *
   * Caller MUST pass `accessRole` for any path that hands the DTO to a
   * non-owner. Defaults to `'owner'` only because most callsites already gate
   * on ownership.
   */
  toProjectDto(
    project: any,
    accessRole: ProjectAccessRole = 'owner',
  ): UserProjectDto {
    const plain =
      typeof project?.toObject === 'function' ? project.toObject() : project;

    if (plain?.paymentConfig?.stripeSecretKey) {
      plain.paymentConfig = {
        ...plain.paymentConfig,
        stripeSecretKey:
          accessRole === 'owner'
            ? this.maskStripeSecret(plain.paymentConfig.stripeSecretKey)
            : 'sk_****',
      };
    }

    let dtoPlain: Record<string, unknown> = plain;
    if (typeof dtoPlain.previewUrl === 'string' && dtoPlain.previewUrl) {
      dtoPlain = {
        ...dtoPlain,
        previewUrl:
          withVercelProtectionBypass(dtoPlain.previewUrl) ??
          dtoPlain.previewUrl,
      };
    }
    if (
      dtoPlain.deployment &&
      typeof dtoPlain.deployment === 'object' &&
      dtoPlain.deployment !== null
    ) {
      const dep = dtoPlain.deployment as Record<string, unknown>;
      if (typeof dep.previewUrl === 'string' && dep.previewUrl) {
        dtoPlain = {
          ...dtoPlain,
          deployment: {
            ...dep,
            previewUrl:
              withVercelProtectionBypass(dep.previewUrl) ?? dep.previewUrl,
          },
        };
      }
    }

    // SECURITY: strip encrypted/secret columns before serialization. The global
    // ClassSerializerInterceptor uses class-transformer's default strategy,
    // which would otherwise copy every entity field to the wire — including the
    // ciphertext secrets and internal repo coordinates the DTO never declares.
    // We use an explicit denylist rather than `excludeExtraneousValues: true`
    // because that flag is INCOMPATIBLE with the `@Transform` decorators on
    // `_id` / `userId` (it regenerates those ObjectIds instead of stringifying
    // the source, so every project came back with a wrong `_id` and the SPA
    // 404'd). Mirrors `ProjectMembersService.sanitizeProject`.
    dtoPlain = this.stripProjectSecrets(dtoPlain);

    return plainToInstance(UserProjectDto, dtoPlain);
  }

  /**
   * Remove encrypted/secret + internal-only fields from a plain project object
   * so they never reach the SPA. Strips every `*Enc` field (top-level and
   * nested under `supabase`) plus the internal GitHub coordinates. Non-secret
   * extras are harmless and left as-is.
   */
  private stripProjectSecrets(
    input: Record<string, unknown>,
  ): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input)) {
      if (key.endsWith('Enc')) continue; // appBuildSecretsEnc, etc.
      if (key === 'jarvisGithub') continue; // internal owner/repo/token coords
      out[key] = value;
    }
    const supabase = out.supabase as Record<string, unknown> | null | undefined;
    if (supabase && typeof supabase === 'object') {
      const safe: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(supabase)) {
        if (k.endsWith('Enc')) continue; // serviceRoleKeyEnc, anonKeyEnc, …
        safe[k] = v;
      }
      out.supabase = safe;
    }
    return out;
  }

  /**
   * Decrypt the stored Stripe secret and return a display-safe mask of the
   * form `sk_****<last4>`. Never returns the decrypted key. Owner-only path.
   */
  private maskStripeSecret(encrypted: string): string {
    if (!encrypted) return '';
    try {
      const decrypted = this.encryptionService.decrypt(encrypted);
      if (!decrypted) return 'sk_****';
      const last4 = decrypted.slice(-4);
      return `sk_****${last4}`;
    } catch {
      // Legacy or corrupted value we cannot decrypt — avoid leaking
      // ciphertext through the "last 4" affordance.
      return 'sk_****';
    }
  }
}
