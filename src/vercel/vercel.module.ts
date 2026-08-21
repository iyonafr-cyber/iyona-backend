import { Module, forwardRef } from '@nestjs/common';
import { VercelService } from './vercel.service';
import { VercelWebhookController } from './vercel-webhook.controller';
import { VercelWebhookService } from './vercel-webhook.service';
import { RevisionsModule } from '../revisions/revisions.module';

@Module({
  imports: [forwardRef(() => RevisionsModule)],
  controllers: [VercelWebhookController],
  providers: [VercelService, VercelWebhookService],
  exports: [VercelService],
})
export class VercelModule {}
