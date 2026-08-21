import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  UseGuards,
  Req,
  Query,
} from '@nestjs/common';
import { GitHubService } from './github.service';
import {
  ApiOperation,
  ApiTags,
  ApiBearerAuth,
  ApiResponse,
} from '@nestjs/swagger';
import { AuthGuard } from 'src/auth/guards/auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorator/roles.decorator';
import { UserRole } from 'src/user/roles/roles.enum';
import { CreateRepositoryDto } from './dto/create-repository.dto';
import { PushFilesDto } from './dto/push-files.dto';
import { GitHubIntegrationDto } from './dto/github-integration.dto';
import { GitHubOAuthCallbackDto } from './dto/github-oauth-callback.dto';

@ApiTags('GitHub')
@ApiBearerAuth('JWT-auth')
@UseGuards(AuthGuard, RolesGuard)
@Roles(UserRole.USER)
@Controller('github')
export class GitHubController {
  constructor(private readonly githubService: GitHubService) {}

  @ApiOperation({ summary: 'Get GitHub OAuth authorization URL' })
  @ApiResponse({
    status: 200,
    description: 'Returns the GitHub OAuth authorization URL',
  })
  @Get('auth/url')
  getAuthorizationUrl(@Query('state') state?: string): Promise<{
    data: { url: string };
  }> {
    const url = this.githubService.getAuthorizationUrl(state);
    return Promise.resolve({ data: { url } });
  }

  @ApiOperation({ summary: 'Handle GitHub OAuth callback' })
  @ApiResponse({
    status: 200,
    description: 'GitHub integration created/updated successfully',
    type: GitHubIntegrationDto,
  })
  @Post('auth/callback')
  async handleOAuthCallback(
    @Req() req: any,
    @Body() callbackDto: GitHubOAuthCallbackDto,
  ): Promise<{ data: GitHubIntegrationDto }> {
    const userId = req.user.userId;

    // Exchange code for token
    const accessToken = await this.githubService.exchangeCodeForToken(
      callbackDto.code,
    );

    // Create or update integration
    const integration = await this.githubService.createOrUpdateIntegration(
      userId,
      {
        accessToken,
      },
    );

    return { data: integration };
  }

  @ApiOperation({ summary: 'Get GitHub integration status' })
  @ApiResponse({
    status: 200,
    description: 'Returns GitHub integration if connected',
    type: GitHubIntegrationDto,
  })
  @Get('integration')
  async getIntegration(@Req() req: any): Promise<{
    data: GitHubIntegrationDto | null;
  }> {
    const userId = req.user.userId;
    const integration = await this.githubService.getIntegrationByUserId(userId);
    return { data: integration };
  }

  @ApiOperation({ summary: 'Create a new GitHub repository' })
  @ApiResponse({
    status: 201,
    description: 'Repository created successfully',
  })
  @Post('repositories')
  async createRepository(
    @Req() req: any,
    @Body() createRepoDto: CreateRepositoryDto,
  ): Promise<{ data: any }> {
    const userId = req.user.userId;
    const repo = await this.githubService.createRepository(
      userId,
      createRepoDto,
    );
    return { data: repo };
  }

  @ApiOperation({ summary: 'Get all user repositories' })
  @ApiResponse({
    status: 200,
    description: 'Returns list of user repositories',
  })
  @Get('repositories')
  async getUserRepositories(@Req() req: any): Promise<{ data: any[] }> {
    const userId = req.user.userId;
    const repos = await this.githubService.getUserRepositories(userId);
    return { data: repos };
  }

  @ApiOperation({ summary: 'Push files to a GitHub repository' })
  @ApiResponse({
    status: 200,
    description: 'Files pushed successfully',
  })
  @Post('push')
  async pushFiles(
    @Req() req: any,
    @Body() pushFilesDto: PushFilesDto,
  ): Promise<{ data: any }> {
    const userId = req.user.userId;
    const result = await this.githubService.pushFiles(userId, pushFilesDto);
    return { data: result };
  }

  @ApiOperation({ summary: 'Disconnect GitHub integration' })
  @ApiResponse({
    status: 200,
    description: 'GitHub integration disconnected successfully',
  })
  @Delete('disconnect')
  async disconnectIntegration(@Req() req: any): Promise<{ message: string }> {
    const userId = req.user.userId;
    await this.githubService.disconnectIntegration(userId);
    return { message: 'GitHub integration disconnected successfully' };
  }
}
