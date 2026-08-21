import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Types } from 'mongoose';
import { AuthGuard } from '../../auth/guards/auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorator/roles.decorator';
import { UserRole } from '../../user/roles/roles.enum';
import {
  AdminRequest,
  AuditLogService,
} from '../../admin/audit/audit-log.service';
import { AiProviderKeysService } from '../ai-provider-keys.service';
import { CreateProviderKeyDto } from '../dto/create-provider-key.dto';
import { UpdateProviderKeyDto } from '../dto/update-provider-key.dto';

@ApiTags('admin-ai-provider-keys')
@ApiBearerAuth('JWT-auth')
@Controller('admin/ai-provider-keys')
@UseGuards(AuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminAiProviderKeysController {
  constructor(
    private readonly keys: AiProviderKeysService,
    private readonly audit: AuditLogService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List AI provider keys (masked)' })
  async list() {
    const data = await this.keys.listAll();
    return { data };
  }

  @Post()
  @ApiOperation({ summary: 'Create provider key (encrypted at rest)' })
  async create(@Body() dto: CreateProviderKeyDto, @Req() req: AdminRequest) {
    const actor = AuditLogService.actorFromRequest(req);
    const createdBy = Types.ObjectId.isValid(actor.actorId)
      ? new Types.ObjectId(actor.actorId)
      : null;
    const data = await this.keys.create(dto, createdBy);
    await this.audit.log(actor, {
      action: 'ai_provider_key.created',
      targetType: 'system',
      targetId: data._id,
      before: null,
      after: {
        provider: data.provider,
        name: data.name,
        keyPreview: data.keyPreview,
        priority: data.priority,
        isActive: data.isActive,
      },
    });
    return { data };
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update provider key metadata or rotate secret' })
  async patch(
    @Param('id') id: string,
    @Body() dto: UpdateProviderKeyDto,
    @Req() req: AdminRequest,
  ) {
    const actor = AuditLogService.actorFromRequest(req);
    const prev = await this.keys.findPublicById(id);
    const data = await this.keys.update(id, dto);
    const afterSnapshot = { ...data, apiKeyRotated: Boolean(dto.apiKey) };
    await this.audit.log(actor, {
      action: 'ai_provider_key.updated',
      targetType: 'system',
      targetId: id,
      before: prev
        ? {
            name: prev.name,
            isActive: prev.isActive,
            priority: prev.priority,
            healthStatus: prev.healthStatus,
          }
        : null,
      after: {
        name: afterSnapshot.name,
        isActive: afterSnapshot.isActive,
        priority: afterSnapshot.priority,
        healthStatus: afterSnapshot.healthStatus,
        apiKeyRotated: afterSnapshot.apiKeyRotated,
      },
    });
    return { data };
  }

  @Delete(':id')
  @HttpCode(200)
  @ApiOperation({ summary: 'Delete provider key' })
  async remove(@Param('id') id: string, @Req() req: AdminRequest) {
    const actor = AuditLogService.actorFromRequest(req);
    const prev = await this.keys.findPublicById(id);
    await this.keys.remove(id);
    await this.audit.log(actor, {
      action: 'ai_provider_key.deleted',
      targetType: 'system',
      targetId: id,
      before: prev
        ? {
            provider: prev.provider,
            name: prev.name,
            keyPreview: prev.keyPreview,
          }
        : null,
      after: null,
    });
    return { data: { deleted: true } };
  }

  @Post(':id/test')
  @HttpCode(200)
  @Throttle({ medium: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Test provider key against provider API' })
  async test(@Param('id') id: string, @Req() req: AdminRequest) {
    const actor = AuditLogService.actorFromRequest(req);
    const result = await this.keys.testKey(id);
    await this.audit.log(actor, {
      action: 'ai_provider_key.tested',
      targetType: 'system',
      targetId: id,
      before: null,
      after: { ok: result.ok },
    });
    return { data: result };
  }
}
