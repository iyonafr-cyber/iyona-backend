import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  UserProject,
  UserProjectSchema,
} from '../projects/entities/user-project.entity';
import { AuthModule } from '../auth/auth.module';
import { UserModule } from '../user/user.module';
import { AiModule } from '../ai/ai.module';
import { CursorModule } from '../cursor/cursor.module';
import { RepoModule } from '../repo/repo.module';
import { UiKitModule } from '../ui-kit/ui-kit.module';
import { RevisionsModule } from '../revisions/revisions.module';
import { SpecBuildService } from './spec-build.service';
import { SpecBuildController } from './spec-build.controller';
import { SpecBuildJobService } from './spec-build-job.service';
import {
  SpecBuildJob,
  SpecBuildJobSchema,
} from './entities/spec-build-job.entity';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: UserProject.name, schema: UserProjectSchema },
      { name: SpecBuildJob.name, schema: SpecBuildJobSchema },
    ]),
    forwardRef(() => AuthModule),
    forwardRef(() => UserModule),
    AiModule,
    CursorModule,
    RepoModule,
    UiKitModule,
    RevisionsModule,
  ],
  controllers: [SpecBuildController],
  providers: [SpecBuildService, SpecBuildJobService],
  exports: [SpecBuildService, SpecBuildJobService],
})
export class SpecBuildModule {}
