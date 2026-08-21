import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AgentsService } from './agents.service';
import { CustomAgentsService } from './custom-agents.service';
import { AgentsController } from './agents.controller';
import { AuthModule } from '../auth/auth.module';
import { UserModule } from '../user/user.module';
import { CustomAgent, CustomAgentSchema } from './entities/custom-agent.entity';

@Module({
  imports: [
    AuthModule,
    UserModule,
    MongooseModule.forFeature([
      { name: CustomAgent.name, schema: CustomAgentSchema },
    ]),
  ],
  providers: [AgentsService, CustomAgentsService],
  controllers: [AgentsController],
  exports: [AgentsService, CustomAgentsService],
})
export class AgentsModule {}
