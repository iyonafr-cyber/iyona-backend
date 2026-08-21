import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../auth/guards/auth.guard';
import {
  CurrentUser,
  CurrentUserPayload,
} from '../auth/decorator/current-user.decorator';
import { ApiKeysService, CreatedApiKey } from './api-keys.service';
import { CreateApiKeyDto } from './dto/api-key.dto';

@UseGuards(AuthGuard)
@Controller('organizations/:orgId/api-keys')
export class ApiKeysController {
  constructor(private readonly apiKeysService: ApiKeysService) {}

  @Get()
  async list(
    @Param('orgId') orgId: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    const data = await this.apiKeysService.list(orgId, user.userId);
    return { data };
  }

  @Post()
  async create(
    @Param('orgId') orgId: string,
    @Body() dto: CreateApiKeyDto,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ data: CreatedApiKey }> {
    const data = await this.apiKeysService.create(
      orgId,
      user.userId,
      dto.name,
      dto.scopes,
      dto.expiresAt ? new Date(dto.expiresAt) : null,
    );
    return { data };
  }

  @HttpCode(204)
  @Delete(':id')
  async revoke(
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    await this.apiKeysService.revoke(orgId, user.userId, id);
    return { ok: true };
  }
}
