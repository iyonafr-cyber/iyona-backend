import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import {
  IVercelService,
  VercelDeployment,
  VercelDeploymentStatus,
  VercelFile,
  VercelDomainResponse,
  VercelDomainConfig,
} from './interface/vercel.interface';
import { injectPreviewBridge } from '../preview-bridge/preview-bridge';
import {
  injectSeo,
  type SeoInjectorOptions,
} from '../preview-bridge/seo-injector';
import { injectClickToEdit } from '../preview-bridge/click-to-edit-injector';
import { isDeployableEnvKey } from '../common/deployable-env-key';

@Injectable()
export class VercelService implements IVercelService {
  private readonly logger = new Logger(VercelService.name);
  private readonly httpClient: AxiosInstance;
  private readonly teamId: string | undefined;

  constructor() {
    const token = process.env.VERCEL_TOKEN;
    if (!token) {
      throw new Error('VERCEL_TOKEN is required');
    }

    this.teamId = process.env.VERCEL_TEAM_ID || undefined;

    this.httpClient = axios.create({
      baseURL: 'https://api.vercel.com',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });
  }

  /**
   * Create a deployment on Vercel with the provided files
   */
  async createDeployment(
    projectId: string,
    files: Record<string, string>,
    framework: string = 'vite',
    /**
     * Project-scoped build env. Forwarded to Vercel as the `env` block
     * on `/v13/deployments` so the values are present at `vite build`
     * time. Used by E1 (Supabase) to pipe `VITE_SUPABASE_URL` and
     * `VITE_SUPABASE_ANON_KEY` into the deployed bundle without ever
     * checking them into source.
     */
    envVars?: Record<string, string>,
    /**
     * E14 — SEO + share metadata to bake into `index.html` and to
     * generate `robots.txt` / `sitemap.xml`. When omitted we still
     * emit a permissive robots.txt so the site is crawlable.
     */
    seo?: SeoInjectorOptions,
  ): Promise<VercelDeployment> {
    try {
      // Pull the analytics provider out of the build-env block so we
      // can also bake it into `index.html` as a `window.__JARVIS_ANALYTICS__`
      // global. Without this, visitors who load the deployed app
      // outside the Jarvis workspace would never get the provider
      // configured (the bridge waits for either a parent message or a
      // preset — visitors have neither).
      const analyticsForBridge =
        envVars &&
        envVars.VITE_ANALYTICS_PROVIDER &&
        envVars.VITE_ANALYTICS_PROVIDER !== 'none'
          ? {
              provider: envVars.VITE_ANALYTICS_PROVIDER as
                | 'plausible'
                | 'posthog',
              key: envVars.VITE_ANALYTICS_KEY,
              host: envVars.VITE_ANALYTICS_HOST,
            }
          : undefined;

      // Always inject the preview-bridge first so it's available to
      // all downstream env / config injection. The bridge is the
      // foundation for E3 (runtime errors), E6 (click-to-edit) and
      // E13 (analytics) — see preview-bridge/preview-bridge.ts.
      // E6 — annotate JSX with `data-jarvis-src` BEFORE the bridge so
      // the lookups the bridge does at click time always succeed. Done
      // first so SEO + analytics injection see the annotated files
      // (analyzers occasionally inspect JSX too).
      let mergedFiles = injectClickToEdit(files);

      mergedFiles = injectPreviewBridge(mergedFiles, {
        analytics: analyticsForBridge,
      });

      // E14 — inject SEO meta tags + emit robots.txt / sitemap.xml.
      // We always run this (even with no config) so every deploy has
      // a permissive robots.txt — search visibility is opt-out, not
      // opt-in.
      mergedFiles = injectSeo(mergedFiles, seo ?? {});

      // PR-2.C — env vars are pushed via the Vercel deployment env
      // block below (`env` + `build.env`), which Vite picks up at
      // build time without needing a `.env.production` file in the
      // shipped artifact. Bundling `.env.production` into the file
      // map risked the values landing on the deployed CDN if a
      // future SPA tweak changed the catch-all rewrite, and made
      // them visible to anyone who browsed the Vercel build log.
      // Strip any `.env*` files the AI may have emitted as well.
      for (const key of Object.keys(mergedFiles)) {
        const base = key.replace(/^\/+/, '');
        if (
          base === '.env' ||
          base.startsWith('.env.') ||
          base.endsWith('/.env') ||
          /\/\.env\.[^/]+$/.test(base)
        ) {
          delete mergedFiles[key];
        }
      }

      this.ensureIframeFriendlyVercelJson(mergedFiles);

      // Convert files to Vercel format
      const vercelFiles: VercelFile[] = Object.entries(mergedFiles).map(
        ([path, content]) => ({
          file: path.startsWith('/') ? path.slice(1) : path,
          data: Buffer.from(content).toString('base64'),
          encoding: 'base64' as const,
        }),
      );

      const deploymentName = `jarvis-${projectId}`;

      const params = this.teamId ? { teamId: this.teamId } : {};

      // Hard guard: package.json is required for `npm install`. RevisionsService
      // already enforces this before calling us, so reaching here without one
      // indicates either a legacy path or a programming error — throw rather
      // than silently burning Vercel quota on a deploy that will fail at the
      // first `npm install` with ENOENT.
      const hasPackageJson =
        mergedFiles['package.json'] || mergedFiles['/package.json'];
      if (!hasPackageJson) {
        throw new BadRequestException(
          `Cannot deploy project ${projectId}: package.json is missing from the file set. ` +
            `Ensure code generation completed successfully before calling createDeployment.`,
        );
      }

      // Log file list for debugging (first 10 files)
      const fileList = Object.keys(mergedFiles).slice(0, 10);
      this.logger.log(
        `Creating deployment for project ${projectId} with ${vercelFiles.length} files. Sample files: ${fileList.join(', ')}${Object.keys(mergedFiles).length > 10 ? '...' : ''}`,
      );

      const deploymentEnv =
        envVars && Object.keys(envVars).length > 0
          ? VercelService.filterEnvVars(envVars, projectId, this.logger)
          : undefined;

      const response = await this.httpClient.post(
        '/v13/deployments',
        {
          name: deploymentName,
          files: vercelFiles,
          projectSettings: {
            framework,
            buildCommand: 'npm run build',
            outputDirectory: 'dist',
            installCommand: 'npm install',
          },
          target: 'production',
          ...(deploymentEnv
            ? { env: deploymentEnv, build: { env: deploymentEnv } }
            : {}),
        },
        { params },
      );

      const deployment: VercelDeployment = {
        id: response.data.id,
        url: response.data.url,
        readyState: response.data.readyState,
        createdAt: response.data.createdAt,
      };

      this.logger.log(
        `Created deployment ${deployment.id} at ${deployment.url} with initial state: ${deployment.readyState}`,
      );

      return deployment;
    } catch (error) {
      const errorMessage =
        error.response?.data?.error?.message || error.message;
      this.logger.error(
        `Failed to create deployment for project ${projectId}: ${errorMessage}`,
      );

      // Log full error response for debugging
      if (error.response?.data) {
        this.logger.error(
          `Vercel API error response: ${JSON.stringify(error.response.data, null, 2)}`,
        );
      }

      // Log request details if available
      if (error.config) {
        this.logger.error(
          `Request URL: ${error.config.url}, Method: ${error.config.method}`,
        );
      }

      throw new BadRequestException(
        errorMessage || 'Failed to create deployment. Check logs for details.',
      );
    }
  }

  /**
   * Get the status of a deployment
   */
  async getDeploymentStatus(
    deploymentId: string,
  ): Promise<VercelDeploymentStatus> {
    try {
      const params = this.teamId ? { teamId: this.teamId } : {};

      const response = await this.httpClient.get(
        `/v13/deployments/${deploymentId}`,
        { params },
      );

      const status: VercelDeploymentStatus = {
        id: response.data.id,
        readyState: response.data.readyState,
        url: response.data.url,
        alias: response.data.alias,
        error: response.data.error,
      };

      // Log additional error information if deployment failed
      if (
        response.data.readyState === 'ERROR' ||
        response.data.readyState === 'CANCELED'
      ) {
        this.logger.error(
          `Deployment ${deploymentId} failed with state: ${response.data.readyState}`,
        );
        this.logger.error(
          `Full deployment response: ${JSON.stringify(response.data, null, 2)}`,
        );

        // Log error details if available
        if (response.data.error) {
          this.logger.error(
            `Deployment error object: ${JSON.stringify(response.data.error, null, 2)}`,
          );
        }

        // Log build logs URL if available
        if (response.data.buildLogs) {
          this.logger.error(`Build logs URL: ${response.data.buildLogs}`);
        }

        // Log any additional error fields
        if (response.data.errorMessage) {
          this.logger.error(`Error message: ${response.data.errorMessage}`);
        }
        if (response.data.buildError) {
          this.logger.error(
            `Build error: ${JSON.stringify(response.data.buildError, null, 2)}`,
          );
        }
      }

      // Include build logs URL if available
      if (response.data.buildLogs) {
        this.logger.log(
          `Build logs available for deployment ${deploymentId}: ${response.data.buildLogs}`,
        );
      }

      return status;
    } catch (error) {
      const errorMsg = error.response?.data?.error?.message || error.message;
      this.logger.error(
        `Failed to get deployment status for ${deploymentId}: ${errorMsg}`,
      );
      if (error.response?.data) {
        this.logger.error(
          `Vercel API response: ${JSON.stringify(error.response.data)}`,
        );
      }
      throw error;
    }
  }

  /**
   * Best-effort delete of a single deployment. Logs and swallows errors so
   * cascading project deletes never hard-fail on Vercel-side issues.
   */
  async deleteDeployment(deploymentId: string): Promise<boolean> {
    if (!deploymentId) return false;

    try {
      const params = this.teamId ? { teamId: this.teamId } : {};
      await this.httpClient.delete(`/v13/deployments/${deploymentId}`, {
        params,
      });
      this.logger.log(`Deleted Vercel deployment ${deploymentId}`);
      return true;
    } catch (error) {
      const status = error.response?.status;
      // 404 means the deployment is already gone - treat as success.
      if (status === 404) return true;
      this.logger.warn(
        `Failed to delete Vercel deployment ${deploymentId}: ${
          error.response?.data?.error?.message || error.message
        }`,
      );
      return false;
    }
  }

  /**
   * Best-effort delete of an entire Vercel project (e.g. `jarvis-<id>`) when a
   * Jarvis project is hard-purged. Deleting the project also releases its
   * domains and deployments on Vercel's side. Errors are logged, not thrown —
   * purge must continue even if this fails.
   */
  async deleteVercelProject(vercelProjectName: string): Promise<boolean> {
    if (!vercelProjectName) return false;
    try {
      const params = this.teamId ? { teamId: this.teamId } : {};
      await this.httpClient.delete(`/v9/projects/${vercelProjectName}`, {
        params,
      });
      this.logger.log(`Deleted Vercel project ${vercelProjectName}`);
      return true;
    } catch (error) {
      const status = error.response?.status;
      // 404 → already gone; treat as success.
      if (status === 404) return true;
      this.logger.warn(
        `Failed to delete Vercel project ${vercelProjectName}: ${
          error.response?.data?.error?.message || error.message
        }`,
      );
      return false;
    }
  }

  /**
   * Best-effort remove of an alias. Errors are logged, not thrown.
   */
  async removeAlias(alias: string): Promise<boolean> {
    if (!alias) return false;
    const bare = alias.replace(/^https?:\/\//, '');

    try {
      const params = this.teamId ? { teamId: this.teamId } : {};
      await this.httpClient.delete(`/v2/aliases/${bare}`, { params });
      this.logger.log(`Removed Vercel alias ${bare}`);
      return true;
    } catch (error) {
      const status = error.response?.status;
      if (status === 404) return true;
      this.logger.warn(
        `Failed to remove Vercel alias ${bare}: ${
          error.response?.data?.error?.message || error.message
        }`,
      );
      return false;
    }
  }

  /**
   * Assign an alias to a deployment
   * This creates a stable URL that always points to the latest deployment
   */
  async assignAlias(deploymentId: string, alias: string): Promise<string> {
    try {
      const params = this.teamId ? { teamId: this.teamId } : {};

      // The alias should be in format: subdomain.domain.com
      // For *.jarvis.site, alias would be like: p-projectId.jarvis.site
      const fullAlias = alias.includes('.') ? alias : `${alias}.jarvis.site`;

      this.logger.log(
        `Assigning alias ${fullAlias} to deployment ${deploymentId}`,
      );

      const response = await this.httpClient.post(
        `/v2/deployments/${deploymentId}/aliases`,
        { alias: fullAlias },
        { params },
      );

      this.logger.log(`Assigned alias ${fullAlias} successfully`);

      return `https://${response.data.alias}`;
    } catch (error) {
      // If alias already exists on another deployment, Vercel moves it automatically
      if (error.response?.status === 409) {
        this.logger.log(`Alias already exists, moving to new deployment`);
        // Try again - Vercel should handle this
        return `https://${alias.includes('.') ? alias : `${alias}.jarvis.site`}`;
      }

      this.logger.error(
        `Failed to assign alias: ${error.response?.data?.error?.message || error.message}`,
      );
      throw new BadRequestException(
        error.response?.data?.error?.message || 'Failed to assign alias',
      );
    }
  }

  // ==================== CUSTOM DOMAIN MANAGEMENT ====================

  /**
   * Add a custom domain to a Vercel project.
   * Uses POST /v10/projects/{idOrName}/domains
   */
  async addDomainToProject(
    vercelProjectName: string,
    domain: string,
  ): Promise<VercelDomainResponse> {
    try {
      const params = this.teamId ? { teamId: this.teamId } : {};

      this.logger.log(
        `Adding domain ${domain} to Vercel project ${vercelProjectName}`,
      );

      const response = await this.httpClient.post(
        `/v10/projects/${vercelProjectName}/domains`,
        { name: domain },
        { params },
      );

      this.logger.log(
        `Domain ${domain} added. Verified: ${response.data.verified}`,
      );

      return response.data;
    } catch (error) {
      const errorMessage =
        error.response?.data?.error?.message || error.message;
      this.logger.error(
        `Failed to add domain ${domain} to project ${vercelProjectName}: ${errorMessage}`,
      );

      if (error.response?.data?.error?.code === 'domain_already_in_use') {
        throw new BadRequestException(
          `Domain "${domain}" is already in use by another Vercel project. Remove it there first, or use a different domain.`,
        );
      }

      throw new BadRequestException(
        errorMessage || 'Failed to add domain to Vercel project',
      );
    }
  }

  /**
   * Remove a custom domain from a Vercel project.
   * Uses DELETE /v9/projects/{idOrName}/domains/{domain}
   */
  async removeDomainFromProject(
    vercelProjectName: string,
    domain: string,
  ): Promise<void> {
    try {
      const params = this.teamId ? { teamId: this.teamId } : {};

      this.logger.log(
        `Removing domain ${domain} from Vercel project ${vercelProjectName}`,
      );

      await this.httpClient.delete(
        `/v9/projects/${vercelProjectName}/domains/${domain}`,
        { params },
      );

      this.logger.log(`Domain ${domain} removed successfully`);
    } catch (error) {
      const errorMessage =
        error.response?.data?.error?.message || error.message;
      this.logger.error(`Failed to remove domain ${domain}: ${errorMessage}`);
      throw new BadRequestException(
        errorMessage || 'Failed to remove domain from Vercel project',
      );
    }
  }

  /**
   * Get DNS configuration required for a domain.
   * Uses GET /v6/domains/{domain}/config
   */
  async getDomainConfig(domain: string): Promise<VercelDomainConfig> {
    try {
      const params = this.teamId ? { teamId: this.teamId } : {};

      const response = await this.httpClient.get(
        `/v6/domains/${domain}/config`,
        { params },
      );

      return response.data;
    } catch (error) {
      const errorMessage =
        error.response?.data?.error?.message || error.message;
      this.logger.error(
        `Failed to get domain config for ${domain}: ${errorMessage}`,
      );
      throw new BadRequestException(
        errorMessage || 'Failed to get domain configuration',
      );
    }
  }

  /**
   * Trigger domain verification for a project.
   * Uses POST /v9/projects/{idOrName}/domains/{domain}/verify
   */
  async verifyProjectDomain(
    vercelProjectName: string,
    domain: string,
  ): Promise<VercelDomainResponse> {
    try {
      const params = this.teamId ? { teamId: this.teamId } : {};

      this.logger.log(
        `Verifying domain ${domain} for project ${vercelProjectName}`,
      );

      const response = await this.httpClient.post(
        `/v9/projects/${vercelProjectName}/domains/${domain}/verify`,
        {},
        { params },
      );

      this.logger.log(
        `Domain ${domain} verification result: verified=${response.data.verified}`,
      );

      return response.data;
    } catch (error) {
      const errorMessage =
        error.response?.data?.error?.message || error.message;
      this.logger.error(`Failed to verify domain ${domain}: ${errorMessage}`);
      throw new BadRequestException(errorMessage || 'Failed to verify domain');
    }
  }

  /**
   * Fetch the build log output for a Vercel deployment.
   *
   * Uses `GET /v2/deployments/{id}/events` which streams newline-delimited
   * JSON. Each event has a `type` (stdout | stderr | command | …) and a
   * `payload.text` field. We collect stdout + stderr and join them into a
   * single string that callers can regex for TypeScript error lines.
   *
   * The endpoint returns a JSON array on modern Vercel API versions, but
   * older responses may come back as NDJSON. We handle both.
   */
  async getDeploymentLogs(deploymentId: string, tailKb = 32): Promise<string> {
    try {
      const params: Record<string, string> = { direction: 'forward' };
      if (this.teamId) params.teamId = this.teamId;

      const response = await this.httpClient.get(
        `/v2/deployments/${deploymentId}/events`,
        { params, responseType: 'text' },
      );

      const raw: string =
        typeof response.data === 'string'
          ? response.data
          : JSON.stringify(response.data);

      const lines: string[] = [];

      // Handle both JSON array and NDJSON (one JSON object per line).
      const trimmed = raw.trim();
      if (trimmed.startsWith('[')) {
        // JSON array
        let events: any[];
        try {
          events = JSON.parse(trimmed);
        } catch {
          events = [];
        }
        for (const ev of events) {
          if (ev.type === 'stdout' || ev.type === 'stderr') {
            const text: string =
              ev.payload?.text ?? ev.text ?? ev.message ?? '';
            if (text) lines.push(text);
          }
        }
      } else {
        // NDJSON — one JSON object per line
        for (const line of trimmed.split('\n')) {
          if (!line.trim()) continue;
          try {
            const ev = JSON.parse(line);
            if (ev.type === 'stdout' || ev.type === 'stderr') {
              const text: string =
                ev.payload?.text ?? ev.text ?? ev.message ?? '';
              if (text) lines.push(text);
            }
          } catch {
            // Non-JSON line — include as-is so TS error regex still works
            lines.push(line);
          }
        }
      }

      const result = lines.join('\n');
      this.logger.debug(
        `Fetched ${lines.length} log lines for deployment ${deploymentId}`,
      );
      const maxBytes = tailKb * 1024;
      if (Buffer.byteLength(result) <= maxBytes) return result;
      return result.slice(-maxBytes);
    } catch (error) {
      const msg = error.response?.data?.error?.message || error.message;
      this.logger.warn(
        `Failed to fetch logs for deployment ${deploymentId}: ${msg}`,
      );
      // Return empty string so callers can still decide how to proceed.
      return '';
    }
  }

  /**
   * Filter env-var map before forwarding to the Vercel deployment API.
   *
   * Only keys that match an explicitly allowed prefix are forwarded.
   * Keys matching the blocked-prefix list are dropped and logged so ops
   * can audit injection attempts. This prevents a compromised caller
   * from injecting NODE_OPTIONS, PATH, or similar build-time overrides
   * that could execute arbitrary code inside the Vercel build container.
   */
  static filterEnvVars(
    raw: Record<string, string>,
    projectId: string,
    logger: import('@nestjs/common').LoggerService,
  ): Record<string, string> | undefined {
    const filtered: Record<string, string> = {};
    for (const [key, value] of Object.entries(raw)) {
      if (!isDeployableEnvKey(key)) {
        (logger as { warn?: (msg: string) => void }).warn?.(
          `[VercelEnvFilter] Key "${key}" is not deployable (blocked or not allowlisted) for project ${projectId}`,
        );
        continue;
      }

      // Reject newlines and null bytes in values to prevent header-injection.
      if (/\u0000|[\n\r]/.test(value)) {
        (logger as { warn?: (msg: string) => void }).warn?.(
          `[VercelEnvFilter] Key "${key}" has unsafe value chars — filtered for project ${projectId}`,
        );
        continue;
      }

      // Cap value length to 4096 chars (Vercel's own limit).
      filtered[key] = value.slice(0, 4096);
    }

    return Object.keys(filtered).length > 0 ? filtered : undefined;
  }

  /**
   * Resolves preview iframe / CORS allowlists used in `vercel.json` headers.
   */
  private resolvePreviewHeaderEnv(): {
    frameAncestors: string;
    acaoHeader: string;
  } {
    const frameAncestors = (
      process.env.PREVIEW_FRAME_ANCESTORS ||
      "'self' https://jarvis.site https://www.jarvis.site https://dev.jarvis.site https://*.jarvis.site https://*.vercel.app http://localhost:3000 http://localhost:4000 http://localhost:4173 http://localhost:5173 http://localhost:5174 http://127.0.0.1:5173 http://127.0.0.1:5174"
    ).trim();
    const explicitAcao = process.env.PREVIEW_ACAO_ALLOW_ORIGIN?.trim();
    const acaoAllowlist = (process.env.PREVIEW_ACAO_ALLOWLIST || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const acaoHeader =
      explicitAcao || (acaoAllowlist.length === 1 ? acaoAllowlist[0] : '*');
    return { frameAncestors, acaoHeader };
  }

  private buildJarvisPreviewSecurityHeaders(
    frameAncestors: string,
    acaoHeader: string,
    cspValue: string,
  ): Array<{ key: string; value: string }> {
    return [
      { key: 'Content-Security-Policy', value: cspValue },
      { key: 'Access-Control-Allow-Origin', value: acaoHeader },
      { key: 'Vary', value: 'Origin' },
      {
        key: 'Strict-Transport-Security',
        value: 'max-age=31536000; includeSubDomains',
      },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      {
        key: 'Referrer-Policy',
        value: 'strict-origin-when-cross-origin',
      },
      {
        key: 'Permissions-Policy',
        value: 'camera=(), microphone=(), geolocation=()',
      },
      { key: 'Cross-Origin-Resource-Policy', value: 'cross-origin' },
    ];
  }

  /**
   * Ensures `frame-ancestors` (and related preview headers) allow the Jarvis
   * workspace to embed the deployment, even when the AI ships its own
   * `vercel.json`. Previously we only injected when `vercel.json` was absent,
   * so a stricter user config could block `localhost:5173` and the iframe
   * would show "refused to connect" / blank.
   */
  private ensureIframeFriendlyVercelJson(
    mergedFiles: Record<string, string>,
  ): void {
    const { frameAncestors, acaoHeader } = this.resolvePreviewHeaderEnv();
    const defaultCsp = `frame-ancestors ${frameAncestors};`;
    const jarvisHeaders = this.buildJarvisPreviewSecurityHeaders(
      frameAncestors,
      acaoHeader,
      defaultCsp,
    );

    const existingKey =
      mergedFiles['vercel.json'] != null
        ? 'vercel.json'
        : mergedFiles['/vercel.json'] != null
          ? '/vercel.json'
          : null;

    if (!existingKey) {
      mergedFiles['vercel.json'] = JSON.stringify(
        {
          rewrites: [{ source: '/(.*)', destination: '/index.html' }],
          framework: 'vite',
          headers: [{ source: '/(.*)', headers: jarvisHeaders }],
        },
        null,
        2,
      );
      return;
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(mergedFiles[existingKey]) as Record<string, unknown>;
    } catch {
      this.logger.warn(
        `vercel.json at ${existingKey} is not valid JSON; replacing with iframe-safe defaults.`,
      );
      mergedFiles['vercel.json'] = JSON.stringify(
        {
          rewrites: [{ source: '/(.*)', destination: '/index.html' }],
          framework: 'vite',
          headers: [{ source: '/(.*)', headers: jarvisHeaders }],
        },
        null,
        2,
      );
      if (existingKey === '/vercel.json') delete mergedFiles['/vercel.json'];
      return;
    }

    this.stripXFrameOptionsFromAllHeaderRules(parsed);
    this.mergeJarvisHeadersIntoVercelConfig(parsed, {
      frameAncestors,
      acaoHeader,
    });

    delete mergedFiles['/vercel.json'];
    mergedFiles['vercel.json'] = JSON.stringify(parsed, null, 2);
  }

  private isCatchAllHeaderSource(source: string): boolean {
    const s = source.trim();
    return (
      s === '/(.*)' ||
      s === '(.*)' ||
      s === '**' ||
      s === '/:path*' ||
      s.includes('(.*)') ||
      /:path\*/.test(s)
    );
  }

  private stripXFrameOptionsFromAllHeaderRules(
    parsed: Record<string, unknown>,
  ): void {
    const headers = parsed['headers'];
    if (!Array.isArray(headers)) return;
    for (const rule of headers) {
      if (!rule || typeof rule !== 'object') continue;
      const r = rule as Record<string, unknown>;
      const hlist = r['headers'];
      if (!Array.isArray(hlist)) continue;
      r['headers'] = hlist.filter((h) => {
        if (!h || typeof h !== 'object') return true;
        const e = h as Record<string, unknown>;
        return String(e['key'] ?? '').toLowerCase() !== 'x-frame-options';
      });
    }
  }

  /**
   * Merges `frame-ancestors` into an existing CSP when possible so we do not
   * strip unrelated directives (e.g. `script-src`) from AI-generated configs.
   */
  private mergeFrameAncestorsIntoCsp(
    existingCsp: string,
    frameAncestors: string,
  ): string {
    const trimmed = existingCsp.trim();
    if (!trimmed) return `frame-ancestors ${frameAncestors};`;
    if (/frame-ancestors\s+/i.test(trimmed)) {
      return trimmed.replace(
        /frame-ancestors[^;]*/gi,
        `frame-ancestors ${frameAncestors}`,
      );
    }
    return `${trimmed}; frame-ancestors ${frameAncestors}`;
  }

  private mergeJarvisHeadersIntoVercelConfig(
    parsed: Record<string, unknown>,
    env: { frameAncestors: string; acaoHeader: string },
  ): void {
    const { frameAncestors, acaoHeader } = env;
    const jarvisControlledKeys = new Set([
      'content-security-policy',
      'access-control-allow-origin',
      'vary',
      'strict-transport-security',
      'x-content-type-options',
      'referrer-policy',
      'permissions-policy',
    ]);

    let headersRaw = parsed['headers'];
    if (!Array.isArray(headersRaw)) {
      headersRaw = [];
      parsed['headers'] = headersRaw;
    }
    const headerRules = headersRaw as unknown[];

    const catchIdx = headerRules.findIndex((rule) => {
      if (!rule || typeof rule !== 'object') return false;
      const src = String((rule as Record<string, unknown>)['source'] ?? '');
      return this.isCatchAllHeaderSource(src);
    });

    if (catchIdx < 0) {
      const defaultCsp = `frame-ancestors ${frameAncestors};`;
      headerRules.push({
        source: '/(.*)',
        headers: this.buildJarvisPreviewSecurityHeaders(
          frameAncestors,
          acaoHeader,
          defaultCsp,
        ),
      });
      return;
    }

    const rule = headerRules[catchIdx] as Record<string, unknown>;
    const hlistRaw = rule['headers'];
    const hlist: unknown[] = Array.isArray(hlistRaw) ? hlistRaw : [];
    const entries: Array<{ key: string; value: string }> = [];
    let userCsp: string | undefined;
    for (const h of hlist) {
      if (!h || typeof h !== 'object') continue;
      const e = h as Record<string, unknown>;
      const key = String(e['key'] ?? '');
      const lower = key.toLowerCase();
      if (lower === 'content-security-policy') {
        userCsp = String(e['value'] ?? '');
        continue;
      }
      if (jarvisControlledKeys.has(lower)) continue;
      entries.push({ key, value: String(e['value'] ?? '') });
    }

    const mergedCsp = userCsp
      ? this.mergeFrameAncestorsIntoCsp(userCsp, frameAncestors)
      : `frame-ancestors ${frameAncestors};`;

    const mergedJarvis = this.buildJarvisPreviewSecurityHeaders(
      frameAncestors,
      acaoHeader,
      mergedCsp,
    );
    rule['headers'] = [...entries, ...mergedJarvis];
  }
}
