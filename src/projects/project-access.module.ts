import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UserProject, UserProjectSchema } from './entities/user-project.entity';
import {
  ProjectMember,
  ProjectMemberSchema,
} from './entities/project-member.entity';
import { ProjectAccessService } from './project-access.service';

/**
 * Lightweight, dependency-free access module.
 *
 * `ProjectAccessService` only needs the `UserProject` + `ProjectMember`
 * models to answer "may this user view / mutate this project?". Pulling it
 * out of the heavy `ProjectsModule` lets unrelated modules (e.g. `AiModule`)
 * enforce project ownership without importing the whole projects graph —
 * and without risking the circular-dependency tangle that graph carries.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: UserProject.name, schema: UserProjectSchema },
      { name: ProjectMember.name, schema: ProjectMemberSchema },
    ]),
  ],
  providers: [ProjectAccessService],
  exports: [ProjectAccessService],
})
export class ProjectAccessModule {}
