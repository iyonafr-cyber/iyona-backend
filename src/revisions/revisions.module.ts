import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { RevisionsController } from './revisions.controller';
import { RevisionsService } from './revisions.service';
import { Revision, RevisionSchema } from './entities/revision.entity';
import { Deployment, DeploymentSchema } from './entities/deployment.entity';
import {
  UserProject,
  UserProjectSchema,
} from '../projects/entities/user-project.entity';
import { S3Module } from '../s3/s3.module';
import { VercelModule } from '../vercel/vercel.module';

import { SupabaseModule } from '../supabase/supabase.module';
import { AuthModule } from '../auth/auth.module';
import { UserModule } from '../user/user.module';
import { ProjectsModule } from '../projects/projects.module';
import { EncryptionModule } from '../encryption/encryption.module';
import { RepoModule } from '../repo/repo.module';
import { CursorModule } from '../cursor/cursor.module';
import { UiKitModule } from '../ui-kit/ui-kit.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Revision.name, schema: RevisionSchema },
      { name: Deployment.name, schema: DeploymentSchema },
      { name: UserProject.name, schema: UserProjectSchema },
    ]),
    S3Module,
    forwardRef(() => VercelModule),
    SupabaseModule,
    EncryptionModule,
    forwardRef(() => AuthModule),
    forwardRef(() => UserModule),
    forwardRef(() => ProjectsModule),
    RepoModule,
    CursorModule,
    UiKitModule,
  ],
  controllers: [RevisionsController],
  providers: [RevisionsService],
  exports: [RevisionsService],
})
export class RevisionsModule {}
