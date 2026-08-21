import { forwardRef, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AiModel, AiModelSchema } from './entities/ai-model.entity';
import {
  AiTaskRoute,
  AiTaskRouteSchema,
} from './entities/ai-task-route.entity';
import { ModelCatalogService } from './models.service';
import { TaskRouteService } from './task-routes.service';
import { ModelsController, PublicModelsController } from './models.controller';
import { AdminModelsController } from './admin-models.controller';
import { AdminTaskRoutesController } from './admin-task-routes.controller';
import { ProviderCatalogService } from './provider-catalog.service';
import { AiProviderKeysModule } from '../ai-provider-keys/ai-provider-keys.module';
import { AuditModule } from '../admin/audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { UserModule } from '../user/user.module';

/**
 * Owns the AI model catalog: DB-backed list, admin CRUD, public
 * read-only picker endpoint, and the "refresh from providers" job. Also
 * owns the per-task routing table (primary + fallback chain per
 * `RouterTask`), which the router consults before the global default.
 *
 * Exports `ModelCatalogService` and `TaskRouteService` so the credits
 * module (router + pricing) can read the live config.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: AiModel.name, schema: AiModelSchema },
      { name: AiTaskRoute.name, schema: AiTaskRouteSchema },
    ]),
    forwardRef(() => AuthModule),
    forwardRef(() => UserModule),
    AiProviderKeysModule,
    AuditModule,
  ],
  providers: [ModelCatalogService, TaskRouteService, ProviderCatalogService],
  controllers: [
    // `PublicModelsController` first so `/models/public` is matched before
    // the guarded `/models` controller can claim it.
    PublicModelsController,
    ModelsController,
    AdminModelsController,
    AdminTaskRoutesController,
  ],
  exports: [ModelCatalogService, TaskRouteService],
})
export class ModelsModule {}
