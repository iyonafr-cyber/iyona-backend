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

@UseGuards(AuthGuard, RolesGuard)
@Roles(UserRole.USER)
@Controller('projects/:projectId/chats')
export class ChatsController {
  constructor(private readonly chatsService: ChatsService) {}

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
