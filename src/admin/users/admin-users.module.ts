import { forwardRef, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { User, UserSchema } from '../../user/entities/user.entity';
import {
  UserProject,
  UserProjectSchema,
} from '../../projects/entities/user-project.entity';
import {
  CreditLedger,
  CreditLedgerSchema,
} from '../../credits/entities/credit-ledger.entity';
import { AuthModule } from '../../auth/auth.module';
import { UserModule } from '../../user/user.module';
import { AuditModule } from '../audit/audit.module';
import { AdminUsersService } from './admin-users.service';
import { AdminUsersController } from './admin-users.controller';
import { EmailModule } from '../../email/email.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: UserProject.name, schema: UserProjectSchema },
      { name: CreditLedger.name, schema: CreditLedgerSchema },
    ]),
    forwardRef(() => AuthModule),
    forwardRef(() => UserModule),
    AuditModule,
    EmailModule,
  ],
  providers: [AdminUsersService],
  controllers: [AdminUsersController],
  exports: [AdminUsersService],
})
export class AdminUsersModule {}
