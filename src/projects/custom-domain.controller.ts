import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';
import { AuthGuard } from 'src/auth/guards/auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorator/roles.decorator';
import { UserRole } from 'src/user/roles/roles.enum';
import {
  CurrentUser,
  CurrentUserPayload,
} from 'src/auth/decorator/current-user.decorator';
import {
  CustomDomainService,
  CustomDomainStatusDto,
} from './custom-domain.service';

class AddCustomDomainDto {
  @IsString()
  @IsNotEmpty()
  domain: string;
}

@ApiTags('Custom Domain')
@ApiBearerAuth('JWT-auth')
@UseGuards(AuthGuard, RolesGuard)
@Roles(UserRole.USER)
@Controller('projects')
export class CustomDomainController {
  constructor(private readonly customDomain: CustomDomainService) {}

  @ApiOperation({ summary: 'Get custom domain status for a project' })
  @Get(':id/custom-domain/status')
  async status(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ data: CustomDomainStatusDto | null }> {
    const status = await this.customDomain.getStatus(id, user.userId);
    return { data: status };
  }

  @ApiOperation({ summary: 'Attach a custom domain to a project' })
  @Post(':id/custom-domain')
  async add(
    @Param('id') id: string,
    @Body() dto: AddCustomDomainDto,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ data: CustomDomainStatusDto }> {
    const status = await this.customDomain.addDomain(
      id,
      dto.domain,
      user.userId,
    );
    return { data: status };
  }

  @ApiOperation({ summary: 'Remove the custom domain from a project' })
  @Delete(':id/custom-domain')
  async remove(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ message: string }> {
    await this.customDomain.removeDomain(id, user.userId);
    return { message: 'Custom domain removed' };
  }

  @ApiOperation({ summary: 'Re-verify the custom domain via Vercel' })
  @Post(':id/custom-domain/verify')
  async verify(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ data: CustomDomainStatusDto }> {
    const status = await this.customDomain.verifyDomain(id, user.userId);
    return { data: status };
  }
}
