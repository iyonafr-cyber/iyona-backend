import { forwardRef, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CursorService } from './cursor.service';
import { AdminCursorController } from './admin-cursor.controller';
import {
  Revision,
  RevisionSchema,
} from 'src/revisions/entities/revision.entity';
import { RepoModule } from 'src/repo/repo.module';
import { AdminSettingsModule } from 'src/admin/settings/admin-settings.module';
import { AuthModule } from 'src/auth/auth.module';
import { UserModule } from 'src/user/user.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Revision.name, schema: RevisionSchema },
    ]),
    RepoModule,
    AdminSettingsModule,
    forwardRef(() => AuthModule),
    forwardRef(() => UserModule),
  ],
  controllers: [AdminCursorController],
  providers: [CursorService],
  exports: [CursorService],
})
export class CursorModule {}
