import { forwardRef, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { User, UserSchema } from '../../user/entities/user.entity';
import {
  UserProject,
  UserProjectSchema,
} from '../../projects/entities/user-project.entity';
import {
  UsageLog,
  UsageLogSchema,
} from '../../credits/entities/usage-log.entity';
import {
  CreditLedger,
  CreditLedgerSchema,
} from '../../credits/entities/credit-ledger.entity';
import { AuthModule } from '../../auth/auth.module';
import { UserModule } from '../../user/user.module';
import { CreditsModule } from '../../credits/credits.module';
import { AdminDashboardService } from './admin-dashboard.service';
import { AdminDashboardController } from './admin-dashboard.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: UserProject.name, schema: UserProjectSchema },
      { name: UsageLog.name, schema: UsageLogSchema },
      { name: CreditLedger.name, schema: CreditLedgerSchema },
    ]),
    forwardRef(() => AuthModule),
    forwardRef(() => UserModule),
    forwardRef(() => CreditsModule),
  ],
  providers: [AdminDashboardService],
  controllers: [AdminDashboardController],
})
export class AdminDashboardModule {}
