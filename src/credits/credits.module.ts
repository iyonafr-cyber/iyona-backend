import { forwardRef, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { User, UserSchema } from '../user/entities/user.entity';
import { AuthModule } from '../auth/auth.module';
import { UserModule } from '../user/user.module';
import { StripeModule } from '../stripe/stripe.module';
import { ModelsModule } from '../models/models.module';
import { AiProviderKeysModule } from '../ai-provider-keys/ai-provider-keys.module';
import {
  CreditLedger,
  CreditLedgerSchema,
} from './entities/credit-ledger.entity';
import { UsageLog, UsageLogSchema } from './entities/usage-log.entity';
import { PricingService } from './pricing.service';
import { ModelRouterService } from './model-router.service';
import { LlmService } from './llm.service';
import { CreditsService } from './credits.service';
import { CreditsTopupService } from './credits-topup.service';
import { CreditsSubscriptionService } from './credits-subscription.service';
import { CreditsGuard } from './guards/credits.guard';
import { CreditsController } from './credits.controller';
import { StripeWebhookController } from './stripe-webhook.controller';
import { OrganizationsModule } from '../organizations/organizations.module';

/**
 * CreditsModule owns every provider instance (OpenAI + Anthropic via
 * `LlmService`), the user-facing balance API, and the audit tables. It's
 * imported by `AiModule` and `PatchModule` so those services can go
 * through `LlmService` instead of spinning up their own clients.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: UsageLog.name, schema: UsageLogSchema },
      { name: CreditLedger.name, schema: CreditLedgerSchema },
    ]),
    forwardRef(() => AuthModule),
    forwardRef(() => UserModule),
    forwardRef(() => StripeModule),
    ModelsModule,
    AiProviderKeysModule,
    forwardRef(() => OrganizationsModule),
  ],
  providers: [
    PricingService,
    ModelRouterService,
    LlmService,
    CreditsService,
    CreditsTopupService,
    CreditsSubscriptionService,
    CreditsGuard,
  ],
  controllers: [CreditsController, StripeWebhookController],
  exports: [
    PricingService,
    ModelRouterService,
    LlmService,
    CreditsService,
    CreditsGuard,
  ],
})
export class CreditsModule {}
