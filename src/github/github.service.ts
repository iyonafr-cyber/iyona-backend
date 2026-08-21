import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { GitHubIntegration } from './entities/github-integration.entity';
import { CreateGitHubIntegrationDto } from './dto/create-github-integration.dto';
import { CreateRepositoryDto } from './dto/create-repository.dto';
import { PushFilesDto } from './dto/push-files.dto';
import { GitHubIntegrationDto } from './dto/github-integration.dto';
import { plainToInstance } from 'class-transformer';
import { logAndThrowError } from 'src/utils/error.utils';
import { secureHexToken } from 'src/common/secure-random';
import { Octokit } from '@octokit/rest';
import axios from 'axios';
import type { IEncryptionService } from 'src/encryption/interface/encryption.interface.service';
import { Inject } from '@nestjs/common';
import type { IUserHelper } from 'src/user/interface/user.helper.interface';

@Injectable()
export class GitHubService {
  private readonly githubClientId: string;
  private readonly githubClientSecret: string;
  private readonly githubRedirectUri: string;

  constructor(
    @InjectModel(GitHubIntegration.name)
    private githubIntegrationModel: Model<GitHubIntegration>,
    @Inject('IEncryptionService')
    private readonly encryptionService: IEncryptionService,
    @Inject('IUserHelper')
    private readonly userHelper: IUserHelper,
  ) {
    this.githubClientId = process.env.GITHUB_CLIENT_ID || '';
    this.githubClientSecret = process.env.GITHUB_CLIENT_SECRET || '';
    // For GitHub integration, use the configured callback URL
    this.githubRedirectUri =
      process.env.GITHUB_INTEGRATION_REDIRECT_URI ||
      process.env.GITHUB_REDIRECT_URI ||
      'http://localhost:5173/auth/github/callback';
  }

  /**
   * Get GitHub OAuth authorization URL
   */
  getAuthorizationUrl(state?: string): string {
    const params = new URLSearchParams({
      client_id: this.githubClientId,
      redirect_uri: this.githubRedirectUri,
      scope: 'repo user:email',
      // CSRF protection on the OAuth round-trip — must be unguessable.
      state: state || secureHexToken(16),
    });

    return `https://github.com/login/oauth/authorize?${params.toString()}`;
  }

  /**
   * Exchange authorization code for access token
   */
  async exchangeCodeForToken(code: string): Promise<string> {
    try {
      const response = await axios.post(
        'https://github.com/login/oauth/access_token',
        {
          client_id: this.githubClientId,
          client_secret: this.githubClientSecret,
          code,
          redirect_uri: this.githubRedirectUri, // Must match the authorization request
        },
        {
          headers: {
            Accept: 'application/json',
          },
        },
      );

      if (response.data.error) {
        throw new BadRequestException(
          response.data.error_description ||
            'Failed to exchange code for token',
        );
      }

      return response.data.access_token;
    } catch (error) {
      throw logAndThrowError('error in exchangeCodeForToken', error);
    }
  }

  /**
   * Get GitHub user info from access token
   */
  async getGitHubUserInfo(accessToken: string): Promise<any> {
    try {
      const octokit = new Octokit({
        auth: accessToken,
      });

      const { data: user } = await octokit.users.getAuthenticated();

      // Get user email
      let email = user.email;
      if (!email) {
        const { data: emails } =
          await octokit.users.listEmailsForAuthenticated();
        const primaryEmail = emails.find((e) => e.primary);
        email = primaryEmail?.email || emails[0]?.email;
      }

      return {
        id: user.id,
        login: user.login,
        name: user.name,
        email: email,
        avatarUrl: user.avatar_url,
        bio: user.bio,
      };
    } catch (error) {
      throw logAndThrowError('error in getGitHubUserInfo', error);
    }
  }

  /**
   * Create or update GitHub integration for a user
   */
  async createOrUpdateIntegration(
    userId: string,
    createDto: CreateGitHubIntegrationDto,
  ): Promise<GitHubIntegrationDto> {
    try {
      // Get GitHub user info
      const githubUser = await this.getGitHubUserInfo(createDto.accessToken);

      // Encrypt access token
      const encryptedToken = this.encryptionService.encrypt(
        createDto.accessToken,
      );

      // Check if integration already exists
      const existingIntegration = await this.githubIntegrationModel
        .findOne({ userId })
        .exec();

      if (existingIntegration) {
        // Update existing integration
        existingIntegration.accessToken = encryptedToken;
        existingIntegration.githubUsername = githubUser.login;
        if (createDto.refreshToken) {
          existingIntegration.refreshToken = this.encryptionService.encrypt(
            createDto.refreshToken,
          );
        }
        if (createDto.tokenExpiresAt) {
          existingIntegration.tokenExpiresAt = createDto.tokenExpiresAt;
        }
        existingIntegration.isActive = true;
        existingIntegration.metadata = {
          avatarUrl: githubUser.avatarUrl,
          email: githubUser.email,
          name: githubUser.name,
          bio: githubUser.bio,
        };

        await existingIntegration.save();

        // Update user's githubConnected field
        await this.userHelper.updateUser(
          { _id: userId },
          { githubConnected: true },
        );

        return plainToInstance(
          GitHubIntegrationDto,
          existingIntegration.toObject(),
        );
      } else {
        // Create new integration
        const integration = await this.githubIntegrationModel.create({
          userId,
          githubUsername: githubUser.login,
          accessToken: encryptedToken,
          refreshToken: createDto.refreshToken
            ? this.encryptionService.encrypt(createDto.refreshToken)
            : undefined,
          tokenExpiresAt: createDto.tokenExpiresAt,
          isActive: true,
          metadata: {
            avatarUrl: githubUser.avatarUrl,
            email: githubUser.email,
            name: githubUser.name,
            bio: githubUser.bio,
          },
        });

        // Update user's githubConnected field
        await this.userHelper.updateUser(
          { _id: userId },
          { githubConnected: true },
        );

        return plainToInstance(GitHubIntegrationDto, integration.toObject());
      }
    } catch (error) {
      throw logAndThrowError('error in createOrUpdateIntegration', error);
    }
  }

  /**
   * Get GitHub integration for a user
   */
  async getIntegrationByUserId(
    userId: string,
  ): Promise<GitHubIntegrationDto | null> {
    try {
      const integration = await this.githubIntegrationModel
        .findOne({ userId, isActive: true })
        .exec();

      if (!integration) {
        return null;
      }

      return plainToInstance(GitHubIntegrationDto, integration.toObject());
    } catch (error) {
      throw logAndThrowError('error in getIntegrationByUserId', error);
    }
  }

  /**
   * Get decrypted access token for a user
   */
  private async getAccessToken(userId: string): Promise<string> {
    const integration = await this.githubIntegrationModel
      .findOne({ userId, isActive: true })
      .exec();

    if (!integration) {
      throw new NotFoundException(
        'GitHub integration not found. Please connect your GitHub account.',
      );
    }

    return this.encryptionService.decrypt(integration.accessToken);
  }

  /**
   * Create a GitHub repository
   */
  async createRepository(
    userId: string,
    createRepoDto: CreateRepositoryDto,
  ): Promise<any> {
    try {
      const accessToken = await this.getAccessToken(userId);
      const octokit = new Octokit({
        auth: accessToken,
      });

      // Get GitHub username
      const integration = await this.githubIntegrationModel
        .findOne({ userId, isActive: true })
        .exec();
      if (!integration) {
        throw new NotFoundException('GitHub integration not found');
      }

      // Create repository
      const { data: repo } = await octokit.repos.createForAuthenticatedUser({
        name: createRepoDto.name,
        description: createRepoDto.description || '',
        private: createRepoDto.private || false,
        auto_init: createRepoDto.autoInit !== false,
      });

      // Update integration with new repository
      if (!integration.repositoryIds.includes(repo.full_name)) {
        integration.repositoryIds.push(repo.full_name);
        await integration.save();
      }

      return {
        id: repo.id,
        name: repo.name,
        fullName: repo.full_name,
        url: repo.html_url,
        cloneUrl: repo.clone_url,
        private: repo.private,
        createdAt: repo.created_at,
      };
    } catch (error) {
      if (error.status === 422) {
        throw new BadRequestException(
          'Repository name already exists or is invalid',
        );
      }
      throw logAndThrowError('error in createRepository', error);
    }
  }

  /**
   * Get all repositories for a user
   */
  async getUserRepositories(userId: string): Promise<any[]> {
    try {
      const accessToken = await this.getAccessToken(userId);
      const octokit = new Octokit({
        auth: accessToken,
      });

      const { data: repos } = await octokit.repos.listForAuthenticatedUser({
        sort: 'updated',
        direction: 'desc',
      });

      return repos.map((repo) => ({
        id: repo.id,
        name: repo.name,
        fullName: repo.full_name,
        url: repo.html_url,
        cloneUrl: repo.clone_url,
        private: repo.private,
        description: repo.description,
        createdAt: repo.created_at,
        updatedAt: repo.updated_at,
      }));
    } catch (error) {
      throw logAndThrowError('error in getUserRepositories', error);
    }
  }

  /**
   * Push files to a GitHub repository
   */
  async pushFiles(userId: string, pushFilesDto: PushFilesDto): Promise<any> {
    try {
      const accessToken = await this.getAccessToken(userId);
      const octokit = new Octokit({
        auth: accessToken,
      });

      const branch = pushFilesDto.branch || 'main';
      const [owner, repo] = pushFilesDto.repository.split('/');

      // Get the current SHA of the branch
      let baseTreeSha: string;
      try {
        const { data: refData } = await octokit.git.getRef({
          owner,
          repo,
          ref: `heads/${branch}`,
        });
        const { data: commitData } = await octokit.git.getCommit({
          owner,
          repo,
          commit_sha: refData.object.sha,
        });
        baseTreeSha = commitData.tree.sha;
      } catch {
        // Branch doesn't exist, create it
        const { data: defaultBranch } = await octokit.repos.get({
          owner,
          repo,
        });
        const { data: refData } = await octokit.git.getRef({
          owner,
          repo,
          ref: `heads/${defaultBranch.default_branch}`,
        });
        const { data: commitData } = await octokit.git.getCommit({
          owner,
          repo,
          commit_sha: refData.object.sha,
        });
        baseTreeSha = commitData.tree.sha;
      }

      // Create blobs for all files
      const tree = await Promise.all(
        pushFilesDto.files.map(async (file) => {
          const { data: blob } = await octokit.git.createBlob({
            owner,
            repo,
            content: file.content,
            encoding: 'utf-8',
          });

          return {
            path: file.path,
            mode: '100644' as const,
            type: 'blob' as const,
            sha: blob.sha,
          };
        }),
      );

      // Create tree
      const { data: treeData } = await octokit.git.createTree({
        owner,
        repo,
        base_tree: baseTreeSha,
        tree,
      });

      // Get current commit SHA
      let parentSha: string;
      try {
        const { data: refData } = await octokit.git.getRef({
          owner,
          repo,
          ref: `heads/${branch}`,
        });
        parentSha = refData.object.sha;
      } catch {
        // Branch doesn't exist, get default branch
        const { data: repoData } = await octokit.repos.get({ owner, repo });
        const { data: refData } = await octokit.git.getRef({
          owner,
          repo,
          ref: `heads/${repoData.default_branch}`,
        });
        parentSha = refData.object.sha;
      }

      // Create commit
      const { data: commit } = await octokit.git.createCommit({
        owner,
        repo,
        message: pushFilesDto.message,
        tree: treeData.sha,
        parents: [parentSha],
      });

      // Update branch reference
      try {
        await octokit.git.updateRef({
          owner,
          repo,
          ref: `heads/${branch}`,
          sha: commit.sha,
        });
      } catch {
        // Branch doesn't exist, create it
        await octokit.git.createRef({
          owner,
          repo,
          ref: `refs/heads/${branch}`,
          sha: commit.sha,
        });
      }

      return {
        commitSha: commit.sha,
        message: pushFilesDto.message,
        filesCount: pushFilesDto.files.length,
        branch,
        url: `https://github.com/${owner}/${repo}/commit/${commit.sha}`,
      };
    } catch (error) {
      throw logAndThrowError('error in pushFiles', error);
    }
  }

  /**
   * Disconnect GitHub integration
   */
  async disconnectIntegration(userId: string): Promise<void> {
    try {
      const integration = await this.githubIntegrationModel
        .findOne({ userId })
        .exec();

      if (!integration) {
        throw new NotFoundException('GitHub integration not found');
      }

      integration.isActive = false;
      await integration.save();
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw logAndThrowError('error in disconnectIntegration', error);
    }
  }
}
