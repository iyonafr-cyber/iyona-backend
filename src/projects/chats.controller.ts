import {
  Controller,
  Get,
  Put,
  Post,
  Param,
  Delete,
  Body,
  UseGuards,
} from '@nestjs/common';
import { ChatsService } from './chats.service';
import { ApiOperation, ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { ChatDto } from './dto/chat.dto';
import {
  CreateChatBodyDto,
  EditChatDto,
  UpdateChatDto,
} from './dto/update-chat.dto';
import { AuthGuard } from 'src/auth/guards/auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorator/roles.decorator';
import { UserRole } from 'src/user/roles/roles.enum';
import {
  CurrentUser,
  CurrentUserPayload,
} from 'src/auth/decorator/current-user.decorator';
import mongoose from 'mongoose';

@ApiTags('Chats')
@ApiBearerAuth('JWT-auth')
@UseGuards(AuthGuard, RolesGuard)
@Roles(UserRole.USER)
@Controller('projects/:projectId/chats')
export class ChatsController {
  constructor(private readonly chatsService: ChatsService) {}

  @ApiOperation({ summary: 'Get all chats for a project' })
  @Get()
  async getChatsByProjectId(
    @Param('projectId') projectId: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ data: ChatDto[] }> {
    const chats = await this.chatsService.getChatsByProjectId(
      projectId,
      user.userId,
    );
    return { data: chats };
  }

  @ApiOperation({ summary: 'Create a new chat for a project' })
  @Post()
  async createChat(
    @Param('projectId') projectId: string,
    @Body() createChatDto: CreateChatBodyDto,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ data: ChatDto }> {
    const chat = await this.chatsService.createChat(
      {
        ...createChatDto,
        projectId: new mongoose.Types.ObjectId(projectId) as any,
      },
      user.userId,
    );
    return { data: chat };
  }

  @ApiOperation({ summary: 'Get a chat by id' })
  @Get(':id')
  async getChatById(
    @Param('projectId') projectId: string,
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ data: ChatDto }> {
    const chat = await this.chatsService.getChatById(
      id,
      user.userId,
      projectId,
    );
    return { data: chat };
  }

  @ApiOperation({ summary: 'Update a chat by id' })
  @Put(':id')
  async updateChat(
    @Param('projectId') projectId: string,
    @Param('id') id: string,
    @Body() updateData: UpdateChatDto,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ data: ChatDto }> {
    const chat = await this.chatsService.updateChat(
      id,
      user.userId,
      updateData,
      projectId,
    );
    return { data: chat };
  }

  @ApiOperation({
    summary: 'Re-run a prompt with corrected wording',
    description:
      'Creates a new version of the message in place and archives every ' +
      'message after it. The client re-enters the planning pipeline from ' +
      'this point instead of appending a correction turn.',
  })
  @Post(':id/edit')
  async editChat(
    @Param('projectId') projectId: string,
    @Param('id') id: string,
    @Body() body: EditChatDto,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ data: { chat: ChatDto; archivedCount: number } }> {
    const result = await this.chatsService.editChat(
      id,
      user.userId,
      body.message,
      projectId,
    );
    return { data: result };
  }

  @ApiOperation({ summary: 'List every version of a chat message' })
  @Get(':id/versions')
  async getChatVersions(
    @Param('projectId') projectId: string,
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ data: ChatDto[] }> {
    const versions = await this.chatsService.getChatVersions(
      id,
      user.userId,
      projectId,
    );
    return { data: versions };
  }

  @ApiOperation({
    summary: 'Swap the transcript back to this version of a message',
    description:
      'Restores the branch archived alongside this version and archives ' +
      'whatever is currently live from this point forward.',
  })
  @Post(':id/activate')
  async activateChatVersion(
    @Param('projectId') projectId: string,
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ data: { chats: ChatDto[]; archivedCount: number } }> {
    const result = await this.chatsService.activateChatVersion(
      id,
      user.userId,
      projectId,
    );
    return { data: result };
  }

  @ApiOperation({ summary: 'Delete a chat by id' })
  @Delete(':id')
  async deleteChat(
    @Param('projectId') projectId: string,
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ message: string }> {
    await this.chatsService.deleteChat(id, user.userId, projectId);
    return { message: 'Chat deleted successfully' };
  }
}
