import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { UserProjectDto } from './dto/user-project-dto.dto';
import { UpdatePaymentConfigDto } from './dto/update-payment-config.dto';
import { UpdateAnalyticsDto } from './dto/update-analytics.dto';
import { UpdateSeoDto } from './dto/update-seo.dto';
import { UpdateGitHubConfigDto } from './dto/update-github-config.dto';
import { UpdateProjectSecretsDto } from './dto/update-project-secrets.dto';
import { ProjectSecretsResponseDto } from './dto/project-secrets-response.dto';
import { ProjectAccessService } from './project-access.service';
import { ProjectMapperService } from './project-mapper.service';
import { RepoService } from 'src/repo/repo.service';
import {
  parseEnvExampleKeys,
  buildSecretsManifestFields,
  MAX_ENV_EXAMPLE_KEYS,
} from 'src/common/parse-env-example';
import type { IEncryptionService } from 'src/encryption/interface/encryption.interface.service';
import { logAndThrowError } from 'src/utils/error.utils';

/**
 * Per-project owner-only settings: build secrets (.env.example → Vercel),
 * Stripe payment config, analytics (E13), SEO/social (E14), and the GitHub
 * config handle. Extracted from `ProjectsService` as part of decomposing that
 * god class.
 *
 * Every method gates on ownership via `ProjectAccessService.requireOwnedProject`
 * and mutates the hydrated document it returns — so no direct model injection
 * is needed. Secret values are validated and encrypted at rest.
 */
@Injectable()
export class ProjectSettingsService {
  constructor(
    private readonly accessService: ProjectAccessService,
    private readonly mapper: ProjectMapperService,
    private readonly repoService: RepoService,
    @Inject('IEncryptionService')
    private readonly encryptionService: IEncryptionService,
  ) {}

  private validateSecretPlaintext(value: string): void {
    if (typeof value !== 'string') {
      throw new BadRequestException('Secret value must be a string');
    }
    if (/\u0000|[\n\r]/.test(value)) {
      throw new BadRequestException(
        'Secret values cannot contain newlines or null bytes',
      );
    }
    if (value.length > 4096) {
      throw new BadRequestException(
        'Secret value exceeds maximum length of 4096 characters',
      );
    }
  }

  async getProjectSecrets(
    projectId: string,
    userId: string,
  ): Promise<ProjectSecretsResponseDto> {
    try {
      const project = await this.accessService.requireOwnedProject(
        userId,
        projectId,
      );
      const gh = project.jarvisGithub;
      if (!gh?.owner || !gh?.repo) {
        throw new BadRequestException(
          'Project has no Jarvis GitHub repository yet.',
        );
      }
      const branch = gh.defaultBranch ?? 'main';
      const raw = await this.repoService.getTextFile(
        gh.owner,
        gh.repo,
        '.env.example',
        branch,
      );
      const { keys: keysFromExample, tooManyKeys } = parseEnvExampleKeys(
        raw ?? '',
      );
      const enc = project.appBuildSecretsEnc ?? {};
      const isSet: Record<string, boolean> = {};
      for (const k of keysFromExample) {
        isSet[k] = Boolean(enc[k]);
      }
      const { deployable } = buildSecretsManifestFields(keysFromExample);
      const keySet = new Set(keysFromExample);
      const orphanKeysInDb = Object.keys(enc).filter((k) => !keySet.has(k));

      return {
        keysFromExample,
        isSet,
        deployable,
        orphanKeysInDb,
        tooManyKeys,
      };
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof ForbiddenException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }
      throw logAndThrowError('error in getProjectSecrets', error);
    }
  }

  async updateProjectSecrets(
    projectId: string,
    userId: string,
    dto: UpdateProjectSecretsDto,
  ): Promise<ProjectSecretsResponseDto> {
    try {
      const project = await this.accessService.requireOwnedProject(
        userId,
        projectId,
      );
      const gh = project.jarvisGithub;
      if (!gh?.owner || !gh?.repo) {
        throw new BadRequestException(
          'Project has no Jarvis GitHub repository yet.',
        );
      }
      const branch = gh.defaultBranch ?? 'main';
      const raw = await this.repoService.getTextFile(
        gh.owner,
        gh.repo,
        '.env.example',
        branch,
      );
      const { keys: allowedKeys, tooManyKeys } = parseEnvExampleKeys(raw ?? '');
      if (tooManyKeys) {
        throw new BadRequestException(
          `.env.example may list at most ${MAX_ENV_EXAMPLE_KEYS} distinct environment keys`,
        );
      }
      const allowed = new Set(allowedKeys);
      const enc: Record<string, string> = {
        ...(project.appBuildSecretsEnc ?? {}),
      };

      for (const [key, value] of Object.entries(dto.values ?? {})) {
        if (!allowed.has(key)) {
          throw new BadRequestException(
            `Key "${key}" is not declared in .env.example`,
          );
        }
        if (value === '') {
          delete enc[key];
          continue;
        }
        this.validateSecretPlaintext(value);
        enc[key] = this.encryptionService.encrypt(value);
      }

      project.appBuildSecretsEnc =
        Object.keys(enc).length > 0 ? enc : undefined;
      project.markModified('appBuildSecretsEnc');
      await project.save();
      return this.getProjectSecrets(projectId, userId);
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof ForbiddenException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }
      throw logAndThrowError('error in updateProjectSecrets', error);
    }
  }

  async deleteProjectSecret(
    projectId: string,
    userId: string,
    key: string,
  ): Promise<void> {
    try {
      const project = await this.accessService.requireOwnedProject(
        userId,
        projectId,
      );
      const dec = decodeURIComponent(key);
      if (!dec || !project.appBuildSecretsEnc?.[dec]) {
        return;
      }
      const next = { ...project.appBuildSecretsEnc };
      delete next[dec];
      project.appBuildSecretsEnc =
        Object.keys(next).length > 0 ? next : undefined;
      project.markModified('appBuildSecretsEnc');
      await project.save();
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof ForbiddenException
      ) {
        throw error;
      }
      throw logAndThrowError('error in deleteProjectSecret', error);
    }
  }

  /**
   * Get payment config for a project (secret key masking happens in the mapper).
   */
  async getPaymentConfig(
    projectId: string,
    userId: string,
  ): Promise<UserProjectDto> {
    try {
      const project = await this.accessService.requireOwnedProject(
        userId,
        projectId,
      );
      return this.mapper.toProjectDto(project);
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof ForbiddenException
      ) {
        throw error;
      }
      throw logAndThrowError('error in getPaymentConfig', error);
    }
  }

  /**
   * Update payment configuration for a project. Encrypts the Stripe secret key
   * before storing.
   */
  async updatePaymentConfig(
    projectId: string,
    userId: string,
    dto: UpdatePaymentConfigDto,
  ): Promise<UserProjectDto> {
    try {
      const project = await this.accessService.requireOwnedProject(
        userId,
        projectId,
      );

      // Initialize paymentConfig if it doesn't exist
      if (!project.paymentConfig) {
        project.paymentConfig = {
          enabled: false,
          stripeMode: 'test',
          connectionValidated: false,
        };
      }

      if (dto.enabled !== undefined) {
        project.paymentConfig.enabled = dto.enabled;
      }
      if (dto.stripePublishableKey !== undefined) {
        project.paymentConfig.stripePublishableKey = dto.stripePublishableKey;
        // Reset validation when keys change
        project.paymentConfig.connectionValidated = false;
      }
      if (dto.stripeSecretKey !== undefined) {
        // Encrypt the secret key before storing
        project.paymentConfig.stripeSecretKey = this.encryptionService.encrypt(
          dto.stripeSecretKey,
        );
        // Reset validation when keys change
        project.paymentConfig.connectionValidated = false;
      }
      if (dto.stripeMode !== undefined) {
        project.paymentConfig.stripeMode = dto.stripeMode;
        // Reset validation when mode changes
        project.paymentConfig.connectionValidated = false;
      }

      await project.save();
      return this.mapper.toProjectDto(project);
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof ForbiddenException
      ) {
        throw error;
      }
      throw logAndThrowError('error in updatePaymentConfig', error);
    }
  }

  /**
   * E13 — persist the analytics provider config. Consumed by the preview-bridge
   * (live in-iframe) and baked into the production build by the deploy pipeline.
   * Setting `provider: 'none'` clears the key/host so we don't leak stale keys.
   */
  async updateAnalyticsConfig(
    projectId: string,
    userId: string,
    dto: UpdateAnalyticsDto,
  ): Promise<UserProjectDto> {
    try {
      const project = await this.accessService.requireOwnedProject(
        userId,
        projectId,
      );

      const next = {
        provider: dto.provider,
        key:
          dto.provider === 'none'
            ? undefined
            : (dto.key ?? '').trim() || undefined,
        host:
          dto.provider === 'none'
            ? undefined
            : (dto.host ?? '').trim() || undefined,
      };

      project.analytics = next as any;
      project.markModified('analytics');
      await project.save();
      return this.mapper.toProjectDto(project);
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof ForbiddenException
      ) {
        throw error;
      }
      throw logAndThrowError('error in updateAnalyticsConfig', error);
    }
  }

  /**
   * E14 — persist SEO + social-share metadata baked into deployed index.html /
   * robots.txt / sitemap.xml on the next deploy. Empty strings collapse to
   * undefined so the deploy doesn't ship blank meta tags.
   */
  async updateSeoConfig(
    projectId: string,
    userId: string,
    dto: UpdateSeoDto,
  ): Promise<UserProjectDto> {
    try {
      const project = await this.accessService.requireOwnedProject(
        userId,
        projectId,
      );

      const trimOrUndef = (v?: string) => {
        const t = (v ?? '').trim();
        return t.length > 0 ? t : undefined;
      };

      project.seo = {
        title: trimOrUndef(dto.title),
        description: trimOrUndef(dto.description),
        ogImage: trimOrUndef(dto.ogImage),
        twitterCard: dto.twitterCard,
        canonical: trimOrUndef(dto.canonical),
        // Default to true so omitting the field doesn't accidentally hide the
        // deployed site from search.
        robotsAllow:
          typeof dto.robotsAllow === 'boolean' ? dto.robotsAllow : true,
      } as any;
      project.markModified('seo');

      await project.save();
      return this.mapper.toProjectDto(project);
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof ForbiddenException
      ) {
        throw error;
      }
      throw logAndThrowError('error in updateSeoConfig', error);
    }
  }

  /**
   * Validate Stripe connection by making a test API call using the project's
   * stored Stripe keys.
   */
  async validateStripeConnection(
    projectId: string,
    userId: string,
  ): Promise<{ valid: boolean; message: string }> {
    try {
      const project = await this.accessService.requireOwnedProject(
        userId,
        projectId,
      );

      if (!project.paymentConfig?.stripeSecretKey) {
        throw new BadRequestException(
          'Stripe secret key is not configured for this project',
        );
      }

      if (!project.paymentConfig?.stripePublishableKey) {
        throw new BadRequestException(
          'Stripe publishable key is not configured for this project',
        );
      }

      // Decrypt the secret key
      const decryptedSecretKey = this.encryptionService.decrypt(
        project.paymentConfig.stripeSecretKey,
      );

      // Make a test call to Stripe API to validate keys
      const response = await fetch('https://api.stripe.com/v1/balance', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${decryptedSecretKey}`,
        },
      });

      if (response.ok) {
        // Mark connection as validated
        project.paymentConfig.connectionValidated = true;
        await project.save();
        return {
          valid: true,
          message: 'Stripe connection validated successfully',
        };
      } else {
        const errorBody = (await response.json()) as {
          error?: { message?: string };
        };
        project.paymentConfig.connectionValidated = false;
        await project.save();
        return {
          valid: false,
          message:
            errorBody?.error?.message || 'Failed to validate Stripe connection',
        };
      }
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof ForbiddenException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }
      throw logAndThrowError('error in validateStripeConnection', error);
    }
  }

  /**
   * Update this project's GitHub configuration (repository handle + autoPush).
   */
  async updateGitHubConfig(
    projectId: string,
    userId: string,
    dto: UpdateGitHubConfigDto,
  ): Promise<UserProjectDto> {
    try {
      const project = await this.accessService.requireOwnedProject(
        userId,
        projectId,
      );

      if (!project.githubConfig) {
        project.githubConfig = { autoPush: false, branch: 'main' } as any;
      }
      if (dto.repository !== undefined) {
        project.githubConfig.repository = dto.repository;
      }
      if (dto.branch !== undefined) {
        project.githubConfig.branch = dto.branch;
      }
      if (dto.autoPush !== undefined) {
        project.githubConfig.autoPush = dto.autoPush;
      }

      await project.save();
      return this.mapper.toProjectDto(project);
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof ForbiddenException
      ) {
        throw error;
      }
      throw logAndThrowError('error in updateGitHubConfig', error);
    }
  }
}
