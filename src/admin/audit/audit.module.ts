import { forwardRef, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  AdminAuditLog,
  AdminAuditLogSchema,
} from './entities/admin-audit-log.entity';
import { AuditLogService } from './audit-log.service';
import { AdminAuditController } from './admin-audit.controller';
import { AuthModule } from '../../auth/auth.module';
import { UserModule } from '../../user/user.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: AdminAuditLog.name, schema: AdminAuditLogSchema },
    ]),
    forwardRef(() => AuthModule),
    forwardRef(() => UserModule),
  ],
  providers: [AuditLogService],
  controllers: [AdminAuditController],
  exports: [AuditLogService],
})
export class AuditModule {}
