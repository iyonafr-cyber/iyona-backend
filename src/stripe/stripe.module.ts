import { Module, forwardRef } from '@nestjs/common';
import { StripeService } from './stripe.service';
import { StripeSeedService } from './stripe-seed.service';
import { StripeController } from './stripe.controller';
import { AuthModule } from '../auth/auth.module';
import { UserModule } from '../user/user.module';

@Module({
  imports: [forwardRef(() => AuthModule), forwardRef(() => UserModule)],
  controllers: [StripeController],
  providers: [StripeService, StripeSeedService],
  exports: [StripeService, StripeSeedService],
})
export class StripeModule {}
