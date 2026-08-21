import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../auth/guards/auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorator/roles.decorator';
import { UserRole } from '../user/roles/roles.enum';
import {
  CurrentUser,
  CurrentUserPayload,
} from '../auth/decorator/current-user.decorator';
import { AgentsService, AgentSummary } from './agents.service';
import { CustomAgentsService } from './custom-agents.service';
import {
  CreateCustomAgentDto,
  UpdateCustomAgentDto,
} from './dto/custom-agent.dto';

@UseGuards(AuthGuard, RolesGuard)
@Roles(UserRole.USER)
@Controller('ai/agents')
export class AgentsController {
  constructor(
    private readonly agents: AgentsService,
    private readonly customAgents: CustomAgentsService,
  ) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  async list(
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ data: AgentSummary[] }> {
    const [builtIns, custom] = await Promise.all([
      Promise.resolve(this.agents.list()),
      this.customAgents.listForUser(user.userId),
    ]);
    return { data: [...builtIns, ...custom] };
  }

  @Get('custom/:slug')
  @HttpCode(HttpStatus.OK)
  async detail(
    @CurrentUser() user: CurrentUserPayload,
    @Param('slug') slug: string,
  ): Promise<{ data: AgentSummary & { instructions: string } }> {
    const data = await this.customAgents.detailForUser(user.userId, slug);
    if (!data) throw new NotFoundException('Specialist not found.');
    return { data };
  }

  @Post('custom')
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: CreateCustomAgentDto,
  ): Promise<{ data: AgentSummary }> {
    const data = await this.customAgents.create(user.userId, dto);
    return { data };
  }

  @Patch('custom/:slug')
  @HttpCode(HttpStatus.OK)
  async update(
    @CurrentUser() user: CurrentUserPayload,
    @Param('slug') slug: string,
    @Body() dto: UpdateCustomAgentDto,
  ): Promise<{ data: AgentSummary }> {
    const data = await this.customAgents.update(user.userId, slug, dto);
    return { data };
  }

  @Delete('custom/:slug')
  @HttpCode(HttpStatus.OK)
  async remove(
    @CurrentUser() user: CurrentUserPayload,
    @Param('slug') slug: string,
  ): Promise<{ data: { slug: string } }> {
    await this.customAgents.remove(user.userId, slug);
    return { data: { slug } };
  }
}
