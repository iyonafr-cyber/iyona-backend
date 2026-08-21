import { forwardRef, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { User, UserSchema } from '../../user/entities/user.entity';
import {
  CreditLedger,
  CreditLedgerSchema,
} from '../../credits/entities/credit-ledger.entity';
import {
  UsageLog,
  UsageLogSchema,
} from '../../credits/entities/usage-log.entity';
import { AuthModule } from '../../auth/auth.module';
import { UserModule } from '../../user/user.module';
import { CreditsModule } from '../../credits/credits.module';
import { AuditModule } from '../audit/audit.module';
import { AdminCreditsService } from './admin-credits.service';
import { AdminCreditsController } from './admin-credits.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: CreditLedger.name, schema: CreditLedgerSchema },
      { name: UsageLog.name, schema: UsageLogSchema },
    ]),
    forwardRef(() => AuthModule),
    forwardRef(() => UserModule),
    forwardRef(() => CreditsModule),
    AuditModule,
  ],
  providers: [AdminCreditsService],
  controllers: [AdminCreditsController],
  exports: [AdminCreditsService],
})
export class AdminCreditsModule {}
