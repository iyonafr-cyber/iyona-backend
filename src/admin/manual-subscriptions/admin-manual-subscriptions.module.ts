import { forwardRef, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { User, UserSchema } from '../../user/entities/user.entity';
import {
  CreditLedger,
  CreditLedgerSchema,
} from '../../credits/entities/credit-ledger.entity';
import { AuthModule } from '../../auth/auth.module';
import { UserModule } from '../../user/user.module';
import { CreditsModule } from '../../credits/credits.module';
import { AuditModule } from '../audit/audit.module';
import { ManualSubscriptionsService } from './manual-subscriptions.service';
import { ManualSubscriptionsController } from './manual-subscriptions.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: CreditLedger.name, schema: CreditLedgerSchema },
    ]),
    forwardRef(() => AuthModule),
    forwardRef(() => UserModule),
    forwardRef(() => CreditsModule),
    AuditModule,
  ],
  providers: [ManualSubscriptionsService],
  controllers: [ManualSubscriptionsController],
  exports: [ManualSubscriptionsService],
})
export class AdminManualSubscriptionsModule {}
