import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { GitHubService } from './github.service';
import { GitHubController } from './github.controller';
import {
  GitHubIntegration,
  GitHubIntegrationSchema,
} from './entities/github-integration.entity';
import { EncryptionModule } from 'src/encryption/encryption.module';
import { UserModule } from 'src/user/user.module';
import { AuthModule } from 'src/auth/auth.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: GitHubIntegration.name, schema: GitHubIntegrationSchema },
    ]),
    EncryptionModule,
    forwardRef(() => UserModule),
    forwardRef(() => AuthModule),
  ],
  controllers: [GitHubController],
  providers: [GitHubService],
  exports: [GitHubService],
})
export class GitHubModule {}
