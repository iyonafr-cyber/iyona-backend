import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../auth/guards/auth.guard';
import {
  CurrentUser,
  CurrentUserPayload,
} from '../auth/decorator/current-user.decorator';
import { WebhooksService } from './webhooks.service';
import { CreateWebhookDto, UpdateWebhookDto } from './dto/webhook.dto';

@UseGuards(AuthGuard)
@Controller('organizations/:orgId/webhooks')
export class WebhooksController {
  constructor(private readonly webhooks: WebhooksService) {}

  @Get()
  async list(
    @Param('orgId') orgId: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    const data = await this.webhooks.list(orgId, user.userId);
    return {
      data: data.map((w: any) => ({
        _id: String(w._id),
        orgId: String(w.orgId),
        name: w.name,
        url: w.url,
        events: w.events,
        enabled: w.enabled,
        secret: w.secret,
        createdAt: w.createdAt,
      })),
    };
  }

  @Post()
  async create(
    @Param('orgId') orgId: string,
    @Body() dto: CreateWebhookDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    const w: any = await this.webhooks.create(
      orgId,
      user.userId,
      dto.name,
      dto.url,
      dto.events,
    );
    return {
      data: {
        _id: String(w._id),
        orgId: String(w.orgId),
        name: w.name,
        url: w.url,
        events: w.events,
        enabled: w.enabled,
        secret: w.secret,
        createdAt: w.createdAt,
      },
    };
  }

  @Patch(':id')
  async update(
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @Body() dto: UpdateWebhookDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    const w: any = await this.webhooks.update(orgId, user.userId, id, dto);
    return {
      data: {
        _id: String(w._id),
        orgId: String(w.orgId),
        name: w.name,
        url: w.url,
        events: w.events,
        enabled: w.enabled,
        secret: w.secret,
      },
    };
  }

  @Delete(':id')
  async remove(
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    await this.webhooks.remove(orgId, user.userId, id);
    return { ok: true };
  }

  @Post(':id/test')
  async test(
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    const d: any = await this.webhooks.testFire(orgId, user.userId, id);
    return { data: { _id: String(d._id), status: d.status } };
  }

  @Get('deliveries/all')
  async listAllDeliveries(
    @Param('orgId') orgId: string,
    @Query('webhookId') webhookId: string | undefined,
    @Query('limit') limit: string | undefined,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    const lim = limit ? parseInt(limit, 10) : 50;
    const data = await this.webhooks.listDeliveries(
      orgId,
      user.userId,
      webhookId,
      lim,
    );
    return {
      data: data.map((d: any) => ({
        _id: String(d._id),
        webhookId: String(d.webhookId),
        event: d.event,
        eventId: d.eventId,
        targetUrl: d.targetUrl,
        status: d.status,
        attempts: d.attempts,
        nextAttemptAt: d.nextAttemptAt,
        lastResponseStatus: d.lastResponseStatus,
        lastResponseBody: d.lastResponseBody,
        lastError: d.lastError,
        deliveredAt: d.deliveredAt,
        createdAt: d.createdAt,
      })),
    };
  }
}
