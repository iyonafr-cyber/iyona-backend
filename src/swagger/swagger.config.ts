// src/swagger/swagger.config.ts
import { INestApplication, Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import basicAuth from 'express-basic-auth';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Register the Swagger UI for this app.
 *
 * Policy:
 *   - In production: Swagger is only enabled if BOTH `SWAGGER_USERNAME` and
 *     `SWAGGER_PASSWORD` are set. Otherwise the route is not registered at
 *     all — we don't expose an unauthenticated docs page publicly.
 *   - In non-production: Swagger is enabled without auth if creds are
 *     missing, so local development keeps working.
 *   - `SWAGGER_ENABLED=false` can be used to force-disable.
 */
export function setupSwagger(app: INestApplication) {
  const logger = new Logger('Swagger');

  if (process.env.SWAGGER_ENABLED === 'false') {
    logger.log('Swagger disabled via SWAGGER_ENABLED=false');
    return;
  }

  const swaggerUsername = process.env.SWAGGER_USERNAME;
  const swaggerPassword = process.env.SWAGGER_PASSWORD;
  const isProduction = process.env.NODE_ENV === 'production';

  if (isProduction && (!swaggerUsername || !swaggerPassword)) {
    logger.warn(
      'Swagger disabled in production: SWAGGER_USERNAME/SWAGGER_PASSWORD not set',
    );
    return;
  }

  const customCss = readFileSync(
    join(process.cwd(), 'public/css/dark-theme.css'),
    'utf8',
  );

  const config = new DocumentBuilder()
    .setTitle(process.env.APPNAME || 'JARVIS AI Backend')
    .setDescription(`API documentation for ${process.env.APPNAME} application`)
    .setVersion('1.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
      },
      'JWT-auth',
    )
    .addApiKey({ type: 'apiKey', in: 'header', name: 'X-API-Key' }, 'api-key')
    .build();

  const document = SwaggerModule.createDocument(app, config);

  if (swaggerUsername && swaggerPassword) {
    app.use(
      '/api-docs',
      basicAuth({
        users: { [swaggerUsername]: swaggerPassword },
        challenge: true,
        realm: 'API Documentation',
      }),
    );
  }

  SwaggerModule.setup('api-docs', app, document, {
    customCss,
  });

  logger.log(
    `Swagger UI available at /api-docs${
      swaggerUsername && swaggerPassword ? ' (basic auth enforced)' : ''
    }`,
  );
}
