// src/main.ts
import { NestFactory, Reflector } from '@nestjs/core';
import { AppModule } from './app.module';
import { setupSwagger } from './swagger/swagger.config';
import { TransformInterceptor } from './interceptors/transform.interceptor';
import { MongoIdNormalizerInterceptor } from './interceptors/mongo-id-normalizer.interceptor';
import { GlobalExceptionFilter } from './common/global-exception.filter';
import {
  BadRequestException,
  ClassSerializerInterceptor,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import * as Sentry from '@sentry/node';
import { json, raw, urlencoded } from 'express';

// Maximum request body size. Generated projects can include many files, but
// this is still an application-level safety net against runaway payloads and
// memory pressure on the API.
const MAX_REQUEST_BODY_SIZE = '10mb';

/**
 * Stripe's webhook signature verification requires the exact raw request
 * body. Registering `express.raw` for this path BEFORE the global JSON
 * parser guarantees Nest hands the untouched Buffer to the webhook
 * controller instead of a parsed object.
 */
const STRIPE_WEBHOOK_PATH = '/api/v1/credits/stripe/webhook';

/**
 * Vercel webhook HMAC-SHA1 verification requires the raw body.
 * Same pattern as Stripe above.
 */
const VERCEL_WEBHOOK_PATH = '/api/v1/integrations/vercel-events';

// Initialize Sentry as early as possible so even bootstrap errors are captured.
// Skipped when SENTRY_DSN is not configured so local/dev keeps the console clean.
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'development',
    release: process.env.SENTRY_RELEASE,
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0.1),
  });
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  // Replace the default Nest logger with pino so every log is structured
  // JSON with a request id attached, ready for Sentry/Datadog forwarding.
  app.useLogger(app.get(Logger));

  // Stripe and Vercel webhook paths need the raw body for signature verification.
  // Mount BEFORE the global JSON parser so the Buffer survives to the controller.
  app.use(
    STRIPE_WEBHOOK_PATH,
    raw({ type: 'application/json', limit: MAX_REQUEST_BODY_SIZE }),
  );
  app.use(
    VERCEL_WEBHOOK_PATH,
    raw({ type: 'application/json', limit: MAX_REQUEST_BODY_SIZE }),
  );

  // Explicit body size limits (Express defaults are only 100kb which is too
  // small for our revision payloads, but we still want a hard cap).
  app.use(json({ limit: MAX_REQUEST_BODY_SIZE }));
  app.use(urlencoded({ limit: MAX_REQUEST_BODY_SIZE, extended: true }));

  // Configure allowed origins for CORS
  // When credentials: true, you cannot use origin: '*'
  const allowedOrigins = [
    'https://jarvis-fe-nine.vercel.app',
    'https://jarvis-admin-one.vercel.app',
    'https://uat.jarvis.site',
    'https://jarvis.site',
    'http://localhost:5173',
    'http://localhost:5174',
    'http://localhost:3000',
    'http://127.0.0.1:5173',
    'http://127.0.0.1:5174',
    'http://127.0.0.1:3000',
    // Dedicated origin env-var for the jarvis-admin SPA (added for the
    // admin MVP so prod admin deploys can live on a separate host).
    ...(process.env.ADMIN_WEB_ORIGIN
      ? process.env.ADMIN_WEB_ORIGIN.split(',').map((o) => o.trim())
      : []),
    ...(process.env.ALLOWED_ORIGINS?.split(',').map((origin) =>
      origin.trim(),
    ) || []),
  ];

  app.enableCors({
    origin: allowedOrigins,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    allowedHeaders: 'Content-Type, Authorization, X-API-Key',
    // PR-2.D — `x-request-id` is set on every response by `pinoHttp.genReqId`
    // and surfaced to support tickets via `ApiErrorListener` on the FE.
    // Browsers ONLY expose response headers listed here when the response
    // is cross-origin (which is the production case: `jarvis.site` →
    // backend on a different host), so without this whitelist
    // `error.response.headers['x-request-id']` would always be undefined
    // and the trace id never reach the toast / Sentry breadcrumb.
    exposedHeaders: ['X-Request-Id'],
    credentials: true, // Needed for cookies/auth
  });

  // PR-2.D — single funnel for every uncaught error. Propagates the
  // x-request-id onto error responses, logs 5xx with full context,
  // and hides raw error messages in production.
  app.useGlobalFilters(new GlobalExceptionFilter());

  // Global serialization interceptor
  app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));

  // Global prefix and versioning
  app.setGlobalPrefix('api');
  app.enableVersioning({
    prefix: 'v',
    defaultVersion: '1',
    type: VersioningType.URI,
  });

  // swagger
  setupSwagger(app);

  // Register TransformInterceptor after all configurations
  app.useGlobalInterceptors(new TransformInterceptor());

  // Must be registered LAST so it runs FIRST on the response leg (NestJS
  // reverses interceptor order on egress). It collapses any `ObjectId` /
  // `Buffer` instances into hex strings before `ClassSerializerInterceptor`
  // shreds them via `class-transformer.classToPlain` — see the file header
  // for the full rationale and the bug it fixes.
  app.useGlobalInterceptors(new MongoIdNormalizerInterceptor());

  // global pipes
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // Strip properties not defined in the DTO (prevents mass-assignment)
      forbidNonWhitelisted: false, // Silently drop unknown fields instead of 400ing existing callers
      transform: true, // Automatically transform payloads to DTO instances
      transformOptions: {
        enableImplicitConversion: true, // Enable implicit type conversion
      },
      exceptionFactory: (errors) => {
        // Custom error messages for better debugging
        const messages = errors.map((error) => {
          const constraints = Object.values(error.constraints || {});
          return `${error.property}: ${constraints.join(', ')}`;
        });
        return new BadRequestException({
          statusCode: 400,
          message: 'Validation failed',
          errors: messages,
        });
      },
    }),
  );

  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
