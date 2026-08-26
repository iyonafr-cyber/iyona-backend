import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ProjectsService } from './projects.service';
import { ChatsService } from './chats.service';
import { ProjectPatchService } from './project-patch.service';
import { ProjectMapperService } from './project-mapper.service';
import { SupabaseProvisioningService } from './supabase-provisioning.service';
import { SupabaseConnectionService } from './supabase-connection.service';
import { PublicProjectsService } from './public-projects.service';
import { ProjectSettingsService } from './project-settings.service';
import { ProjectsController } from './projects.controller';
import { ChatsController } from './chats.controller';
import { ProjectAccessModule } from './project-access.module';
import { ProjectMembersService } from './project-members.service';
import { ProjectMembersController } from './project-members.controller';
import { CustomDomainService } from './custom-domain.service';
import { CustomDomainController } from './custom-domain.controller';
import { UserProject, UserProjectSchema } from './entities/user-project.entity';
import { Chat, ChatSchema } from './entities/chat.entity';
import {
  ProjectError,
  ProjectErrorSchema,
} from './entities/project-error.entity';
import { ProjectErrorsService } from './project-errors.service';
import { User, UserSchema } from 'src/user/entities/user.entity';
import { PublicProjectsController } from './public-projects.controller';
import {
  ProjectMember,
  ProjectMemberSchema,
} from './entities/project-member.entity';
import {
  Revision,
  RevisionSchema,
} from '../revisions/entities/revision.entity';
import {
  Deployment,
  DeploymentSchema,
} from '../revisions/entities/deployment.entity';
import {
  WorkspaceCursorJob,
  WorkspaceCursorJobSchema,
} from './entities/workspace-cursor-job.entity';
import { AuthModule } from 'src/auth/auth.module';
import { UserModule } from 'src/user/user.module';
import { EncryptionModule } from 'src/encryption/encryption.module';
import { PatchModule } from 'src/patch/patch.module';
import { S3Module } from 'src/s3/s3.module';
import { VercelModule } from 'src/vercel/vercel.module';
import { CreditsModule } from 'src/credits/credits.module';
import { SupabaseModule } from 'src/supabase/supabase.module';
import { RepoModule } from 'src/repo/repo.module';
import { CursorModule } from 'src/cursor/cursor.module';
import { WorkspaceController } from './workspace.controller';
import { WorkspaceCursorJobService } from './workspace-cursor-job.service';
import { DatabaseDetectService } from './database-detect.service';
import { RevisionsModule } from 'src/revisions/revisions.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: UserProject.name, schema: UserProjectSchema },
      { name: Chat.name, schema: ChatSchema },
      { name: Revision.name, schema: RevisionSchema },
      { name: Deployment.name, schema: DeploymentSchema },
      { name: WorkspaceCursorJob.name, schema: WorkspaceCursorJobSchema },
      { name: ProjectMember.name, schema: ProjectMemberSchema },
      { name: User.name, schema: UserSchema },
      { name: ProjectError.name, schema: ProjectErrorSchema },
    ]),
    forwardRef(() => AuthModule),
    forwardRef(() => UserModule),
    forwardRef(() => PatchModule),
    forwardRef(() => CreditsModule),
    EncryptionModule,
    S3Module,
    VercelModule,
    SupabaseModule,
    RepoModule,
    CursorModule,
    forwardRef(() => RevisionsModule),
    ProjectAccessModule,
  ],
  providers: [
    ProjectsService,
    ChatsService,
    ProjectPatchService,
    ProjectMapperService,
    SupabaseProvisioningService,
    SupabaseConnectionService,
    PublicProjectsService,
    ProjectSettingsService,
    ProjectMembersService,
    CustomDomainService,
    ProjectErrorsService,
    WorkspaceCursorJobService,
    DatabaseDetectService,
  ],
  controllers: [
    ProjectMembersController,
    CustomDomainController,
    ProjectsController,
    PublicProjectsController,
    ChatsController,
    WorkspaceController,
  ],
  exports: [
    ProjectsService,
    ProjectAccessModule,
    ProjectMembersService,
    CustomDomainService,
    ProjectErrorsService,
  ],
})
export class ProjectsModule {}
