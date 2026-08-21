import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuditModule } from '../admin/audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { UserModule } from '../user/user.module';
import { EncryptionModule } from '../encryption/encryption.module';
import { AiProviderHealthService } from './ai-provider-health.service';
import { AiProviderKeysService } from './ai-provider-keys.service';
import { AiProviderRouterService } from './ai-provider-router.service';
import { AdminAiProviderKeysController } from './controllers/admin-ai-provider-keys.controller';
import {
  AiProviderKey,
  AiProviderKeySchema,
} from './entities/ai-provider-key.entity';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: AiProviderKey.name, schema: AiProviderKeySchema },
    ]),
    EncryptionModule,
    AuditModule,
    forwardRef(() => AuthModule),
    forwardRef(() => UserModule),
  ],
  controllers: [AdminAiProviderKeysController],
  providers: [
    AiProviderKeysService,
    AiProviderHealthService,
    AiProviderRouterService,
  ],
  exports: [
    AiProviderKeysService,
    AiProviderRouterService,
    AiProviderHealthService,
  ],
})
export class AiProviderKeysModule {}
