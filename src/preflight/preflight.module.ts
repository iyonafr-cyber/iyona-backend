import { Module, forwardRef } from '@nestjs/common';
import { PreflightService } from './preflight.service';
import { PreflightController } from './preflight.controller';
import { AiProviderKeysModule } from '../ai-provider-keys/ai-provider-keys.module';
import { CreditsModule } from '../credits/credits.module';
import { AuthModule } from '../auth/auth.module';
import { UserModule } from '../user/user.module';

@Module({
  imports: [
    AiProviderKeysModule,
    CreditsModule,
    forwardRef(() => AuthModule),
    forwardRef(() => UserModule),
  ],
  controllers: [PreflightController],
  providers: [PreflightService],
  exports: [PreflightService],
})
export class PreflightModule {}
