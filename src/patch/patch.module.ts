import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PatchService } from './patch.service';
import {
  ComponentSchema,
  ComponentSchemaModel,
} from './entities/component-schema.entity';
import {
  ProjectSnapshot,
  ProjectSnapshotModel,
} from './entities/project-snapshot.entity';
import {
  UserProject,
  UserProjectSchema,
} from '../projects/entities/user-project.entity';
import { AuthModule } from '../auth/auth.module';
import { UserModule } from '../user/user.module';
import { ProjectsModule } from '../projects/projects.module';
import { CreditsModule } from '../credits/credits.module';

/**
 * PatchModule is now controller-less; the public HTTP surface for the patch
 * engine is served from `ProjectsController`, which calls `PatchService`
 * through `ProjectsService`. This keeps project ownership/authorization
 * checks centralized in a single place.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ComponentSchema.name, schema: ComponentSchemaModel },
      { name: ProjectSnapshot.name, schema: ProjectSnapshotModel },
      { name: UserProject.name, schema: UserProjectSchema },
    ]),
    forwardRef(() => AuthModule),
    forwardRef(() => UserModule),
    forwardRef(() => ProjectsModule),
    forwardRef(() => CreditsModule),
  ],
  providers: [PatchService],
  exports: [PatchService],
})
export class PatchModule {}
