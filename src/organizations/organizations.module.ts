import { forwardRef, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import {
  Organization,
  OrganizationSchema,
} from './entities/organization.entity';
import { OrgMember, OrgMemberSchema } from './entities/org-member.entity';
import { User, UserSchema } from '../user/entities/user.entity';
import { OrganizationsService } from './organizations.service';
import { OrganizationsController } from './organizations.controller';
import { OrgBillingService } from './org-billing.service';
import { OrgBillingController } from './org-billing.controller';
import { SsoService } from './sso.service';
import { SsoController } from './sso.controller';
import { FeatureFlagsGuard } from './feature-flags.guard';
import { AuthModule } from '../auth/auth.module';
import { UserModule } from '../user/user.module';
import { StripeModule } from '../stripe/stripe.module';

@Module({
  imports: [
    ConfigModule,
    MongooseModule.forFeature([
      { name: Organization.name, schema: OrganizationSchema },
      { name: OrgMember.name, schema: OrgMemberSchema },
      { name: User.name, schema: UserSchema },
    ]),
    forwardRef(() => AuthModule),
    forwardRef(() => UserModule),
    StripeModule,
  ],
  providers: [
    OrganizationsService,
    OrgBillingService,
    SsoService,
    FeatureFlagsGuard,
  ],
  controllers: [OrganizationsController, OrgBillingController, SsoController],
  exports: [
    OrganizationsService,
    OrgBillingService,
    SsoService,
    FeatureFlagsGuard,
    MongooseModule,
  ],
})
export class OrganizationsModule {}
