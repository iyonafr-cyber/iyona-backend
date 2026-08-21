import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ApiKey, ApiKeySchema } from './entities/api-key.entity';
import { ApiKeysService } from './api-keys.service';
import { ApiKeysController } from './api-keys.controller';
import { ApiKeyAuthGuard } from './guards/api-key-auth.guard';
import { PublicApiController } from './public-api.controller';
import { OrganizationsModule } from '../organizations/organizations.module';
import { ProjectsModule } from '../projects/projects.module';
import { AuthModule } from '../auth/auth.module';
import { UserModule } from '../user/user.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: ApiKey.name, schema: ApiKeySchema }]),
    OrganizationsModule,
    ProjectsModule,
    AuthModule,
    UserModule,
  ],
  controllers: [ApiKeysController, PublicApiController],
  providers: [ApiKeysService, ApiKeyAuthGuard],
  exports: [ApiKeysService],
})
export class ApiKeysModule {}
