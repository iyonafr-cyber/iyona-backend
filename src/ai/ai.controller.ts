import {
  Controller,
  Post,
  Body,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiOperation, ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { AiService } from './ai.service';
import { AuthGuard } from '../auth/guards/auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorator/roles.decorator';
import { UserRole } from '../user/roles/roles.enum';
import { ValidateInputDto } from './dto/validate-input.dto';
import { GenerateQuestionnaireDto } from './dto/generate-questionnaire.dto';
import { GenerateExecutionPlanDto } from './dto/generate-execution-plan.dto';
import { CreditsGuard } from '../credits/guards/credits.guard';
import { CreditAction } from '../credits/decorator/credit-action.decorator';
import { AuthedRequest } from '../credits/types/authed-request';

/**
 * Helper: pull `userId` and optional `requestId` from a request that has
 * already passed `AuthGuard`. Keeps every handler body tidy.
 */
function ctxFromRequest(req: Request) {
  const authed = req as unknown as AuthedRequest;
  const id = authed.fullUser._id;
  const userId =
    typeof id === 'string'
      ? id
      : ((id as { toHexString?: () => string }).toHexString?.() ?? String(id));
  return {
    userId,
    requestId:
      (req.headers['x-request-id'] as string | undefined) ||
      (req as unknown as { id?: string }).id,
  };
}

@ApiTags('AI')
@ApiBearerAuth('JWT-auth')
@UseGuards(AuthGuard, RolesGuard, CreditsGuard)
@Roles(UserRole.USER)
@Controller('ai')
@Throttle({ ai: { limit: 30, ttl: 60_000 } })
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @ApiOperation({ summary: 'Validate user input for project creation' })
  @CreditAction('validate')
  @Post('validate')
  @HttpCode(HttpStatus.OK)
  async validateInput(@Body() dto: ValidateInputDto, @Req() req: Request) {
    const { data, meta } = await this.aiService.validateInput(
      dto.input,
      dto.images,
      {
        ...ctxFromRequest(req),
        modelId: dto.modelId,
        uiLocale: dto.uiLocale,
        conversationLocale: dto.conversationLocale,
      },
    );
    return { data, meta };
  }

  @ApiOperation({ summary: 'Generate questionnaire for project' })
  @CreditAction('questionnaire')
  @Post('questionnaire')
  @HttpCode(HttpStatus.OK)
  async generateQuestionnaire(
    @Body() dto: GenerateQuestionnaireDto,
    @Req() req: Request,
  ) {
    const { data, meta } = await this.aiService.generateQuestionnaire(
      dto.projectIdea,
      dto.projectName,
      {
        ...ctxFromRequest(req),
        modelId: dto.modelId,
        uiLocale: dto.uiLocale,
        conversationLocale: dto.conversationLocale,
      },
    );
    return { data, meta };
  }

  @ApiOperation({ summary: 'Generate execution plan from questionnaire' })
  @CreditAction('execution_plan')
  @Post('execution-plan')
  @HttpCode(HttpStatus.OK)
  async generateExecutionPlan(
    @Body() dto: GenerateExecutionPlanDto,
    @Req() req: Request,
  ) {
    const { data, meta } = await this.aiService.generateExecutionPlan(
      dto.projectIdea,
      dto.answers,
      {
        ...ctxFromRequest(req),
        modelId: dto.modelId,
        uiLocale: dto.uiLocale,
        conversationLocale: dto.conversationLocale,
      },
      dto.questionLabels,
    );
    return { data, meta };
  }

}
