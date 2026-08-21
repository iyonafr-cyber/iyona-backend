import { Module, forwardRef } from '@nestjs/common';
import { AiService } from './ai.service';
import { AiController } from './ai.controller';
import { AuthModule } from '../auth/auth.module';
import { UserModule } from '../user/user.module';
import { CreditsModule } from '../credits/credits.module';
import { AgentsModule } from '../agents/agents.module';
import { UiKitModule } from '../ui-kit/ui-kit.module';
import { ProjectAccessModule } from '../projects/project-access.module';
import { RevisionsModule } from '../revisions/revisions.module';

@Module({
  imports: [
    AuthModule,
    UserModule,
    forwardRef(() => CreditsModule),
    AgentsModule,
    UiKitModule,
    ProjectAccessModule,
    forwardRef(() => RevisionsModule),
  ],
  providers: [AiService],
  controllers: [AiController],
  exports: [AiService],
})
export class AiModule {}
