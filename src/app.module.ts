import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { LoggerModule } from 'nestjs-pino';
import { TerminusModule } from '@nestjs/terminus';
import { randomUUID } from 'crypto';
import { AuthModule } from './auth/auth.module';
import { UserModule } from './user/user.module';
import { ConfigModule } from '@nestjs/config';
import { ProjectsModule } from './projects/projects.module';
import { GitHubModule } from './github/github.module';
import { S3Module } from './s3/s3.module';
import { VercelModule } from './vercel/vercel.module';
import { RevisionsModule } from './revisions/revisions.module';
import { AiModule } from './ai/ai.module';
import { AgentsModule } from './agents/agents.module';
import { PatchModule } from './patch/patch.module';
import { HealthController } from './health/health.controller';
import { StripeModule } from './stripe/stripe.module';
import { CreditsModule } from './credits/credits.module';
import { ModelsModule } from './models/models.module';
import { AuditModule } from './admin/audit/audit.module';
import { AdminUsersModule } from './admin/users/admin-users.module';
import { DistributedLockModule } from './common/distributed-lock/distributed-lock.module';
import { AdminProjectsModule } from './admin/projects/admin-projects.module';
import { AdminCreditsModule } from './admin/credits/admin-credits.module';
import { AdminDashboardModule } from './admin/dashboard/admin-dashboard.module';
import { AdminSettingsModule } from './admin/settings/admin-settings.module';
import { AdminManualSubscriptionsModule } from './admin/manual-subscriptions/admin-manual-subscriptions.module';
import { OrganizationsModule } from './organizations/organizations.module';
import { ApiKeysModule } from './api-keys/api-keys.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { MigrationsModule } from './migrations/migrations.module';
import { SpecBuildModule } from './spec-build/spec-build.module';
import { AiProviderKeysModule } from './ai-provider-keys/ai-provider-keys.module';
import { PreflightModule } from './preflight/preflight.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // Structured JSON logging via pino, with per-request correlation id.
    // In non-production environments we pretty-print for readability.
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL || 'info',
        genReqId: (req, res) => {
          const existing =
            (req.headers['x-request-id'] as string | undefined) || randomUUID();
          res.setHeader('x-request-id', existing);
          return existing;
        },
        customProps: (req) => ({
          userId: (req as any).user?.userId,
        }),
        redact: {
          // PR-2.D — keep this list aggressive. We'd rather over-redact
          // than ship a secret to a log aggregator. Each entry is a
          // pino path; `*` matches one segment, so `*.password`
          // catches any object key called `password` regardless of
          // depth. Add new fields here as soon as they land in any
          // entity.
          paths: [
            'req.headers.authorization',
            'req.headers.cookie',
            'req.headers["x-api-key"]',
            'req.headers["x-iyona-api-key"]',
            '*.password',
            '*.dbPassword',
            '*.dbPasswordEnc',
            '*.refreshToken',
            '*.accessToken',
            '*.token',
            '*.tokenEnc',
            '*.apiKey',
            '*.apiSecret',
            '*.stripeSecretKey',
            '*.stripeWebhookSecret',
            '*.serviceRoleKey',
            '*.serviceRoleKeyEnc',
            '*.anonKey',
            '*.anonKeyEnc',
            '*.smtpPassword',
            '*.apiKeyEnc',
            '*.providerApiKey',
          ],
          censor: '[REDACTED]',
        },
        transport:
          process.env.NODE_ENV === 'production'
            ? undefined
            : {
                target: 'pino-pretty',
                options: { singleLine: true, colorize: true },
              },
      },
    }),
    TerminusModule,
    // Enables `@Cron`-decorated methods across the app (e.g. the
    // monthly-reset safety net in `CreditsService`).
    ScheduleModule.forRoot(),
    MongooseModule.forRoot(process.env.MONGO_URL, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    }),
    // Cross-process mutual exclusion (replaces the single-process KeyedMutex).
    // Global so RepoService and the deploy pipeline can serialize per-project
    // work across replicas. Declared right after the Mongo connection it needs.
    DistributedLockModule,
    // Named rate-limit buckets. Individual routes opt in with
    // `@Throttle({ <name>: { limit, ttl } })` so we don't accidentally
    // over-limit generic traffic.
    ThrottlerModule.forRoot([
      { name: 'short', ttl: 1000, limit: 30 },
      { name: 'medium', ttl: 60_000, limit: 300 },
      { name: 'auth', ttl: 60_000, limit: 20 },
      { name: 'ai', ttl: 60_000, limit: 30 },
    ]),
    AuthModule,
    UserModule,
    ProjectsModule,
    GitHubModule,
    S3Module,
    VercelModule,
    RevisionsModule,
    AiModule,
    AgentsModule,
    PatchModule,
    StripeModule,
    ModelsModule,
    AiProviderKeysModule,
    CreditsModule,
    AuditModule,
    AdminUsersModule,
    AdminProjectsModule,
    AdminCreditsModule,
    AdminDashboardModule,
    AdminSettingsModule,
    AdminManualSubscriptionsModule,
    OrganizationsModule,
    MigrationsModule,
    ApiKeysModule,
    WebhooksModule,
    SpecBuildModule,
    PreflightModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
