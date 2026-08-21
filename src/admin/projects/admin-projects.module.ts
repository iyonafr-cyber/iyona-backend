import { forwardRef, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { User, UserSchema } from '../../user/entities/user.entity';
import {
  UserProject,
  UserProjectSchema,
} from '../../projects/entities/user-project.entity';
import { Chat, ChatSchema } from '../../projects/entities/chat.entity';
import { AuthModule } from '../../auth/auth.module';
import { UserModule } from '../../user/user.module';
import { AuditModule } from '../audit/audit.module';
import { AdminProjectsService } from './admin-projects.service';
import { AdminProjectsController } from './admin-projects.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: UserProject.name, schema: UserProjectSchema },
      { name: Chat.name, schema: ChatSchema },
    ]),
    forwardRef(() => AuthModule),
    forwardRef(() => UserModule),
    AuditModule,
  ],
  providers: [AdminProjectsService],
  controllers: [AdminProjectsController],
  exports: [AdminProjectsService],
})
export class AdminProjectsModule {}
