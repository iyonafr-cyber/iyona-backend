import { forwardRef, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  AdminSettings,
  AdminSettingsSchema,
} from './entities/admin-settings.entity';
import { AdminSettingsService } from './admin-settings.service';
import {
  AdminSettingsController,
  SystemStatusController,
} from './admin-settings.controller';
import { AuthModule } from '../../auth/auth.module';
import { UserModule } from '../../user/user.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: AdminSettings.name, schema: AdminSettingsSchema },
    ]),
    forwardRef(() => AuthModule),
    forwardRef(() => UserModule),
    AuditModule,
  ],
  providers: [AdminSettingsService],
  controllers: [AdminSettingsController, SystemStatusController],
  exports: [AdminSettingsService],
})
export class AdminSettingsModule {}
