import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { plainToInstance } from 'class-transformer';
import { Chat } from './entities/chat.entity';
import {
  UserProject,
  ProjectStage,
  StageStatus,
} from './entities/user-project.entity';
import { ProjectAccessService } from './project-access.service';
import { ChatDto } from './dto/chat.dto';
import { CreateChatDto } from './dto/create-chat.dto';
import { UpdateChatDto } from './dto/update-chat.dto';
import { logAndThrowError } from 'src/utils/error.utils';

/**
 * Chat transcript persistence + versioning/branching.
 *
 * Extracted from `ProjectsService` (which had grown into an 8-concern god
 * class). Owns the append-only transcript model: every edit archives the tail
 * (`active: false` + `supersededBy`) rather than deleting, so the ‹ n/N ›
 * version picker and branch restore work. Authorization is delegated to
 * `ProjectAccessService`; IDOR is prevented by cross-checking the URL's
 * projectId against the chat's own `projectId` in `loadChatFor`.
 */
@Injectable()
export class ChatsService {
  constructor(
    @InjectModel(Chat.name)
    private readonly chatModel: Model<Chat>,
    @InjectModel(UserProject.name)
    private readonly userProjectModel: Model<UserProject>,
    private readonly accessService: ProjectAccessService,
  ) {}

  /**
   * Load a chat and authorize the caller against its project. Pass
   * `expectedProjectId` (from the URL) to cross-validate — the chat is treated
   * as 404 if it belongs to a different project, so we never leak its existence.
   */
  private async loadChatFor(
    chatId: string,
    userId: string,
    level: 'viewer' | 'editor',
    expectedProjectId?: string,
  ) {
    const chat = await this.chatModel.findById(chatId).exec();
    if (!chat) {
      throw new NotFoundException(`Chat with ID ${chatId} not found`);
    }
    if (
      expectedProjectId &&
      String(chat.projectId) !== String(expectedProjectId)
    ) {
      throw new NotFoundException(`Chat with ID ${chatId} not found`);
    }
    if (level === 'viewer') {
      await this.accessService.requireViewer(userId, String(chat.projectId));
    } else {
      await this.accessService.requireOwnerOrAdmin(
        userId,
        String(chat.projectId),
      );
    }
    return chat;
  }

  async createChat(
    createChatDto: CreateChatDto,
    userId: string,
  ): Promise<ChatDto> {
    try {
      await this.accessService.requireOwnerOrAdmin(
        userId,
        String(createChatDto.projectId),
      );

      const chat = await this.chatModel.create({
        ...createChatDto,
        role: createChatDto.role || 'user',
        orderKey: await this.nextOrderKey(String(createChatDto.projectId)),
        version: 1,
        active: true,
      });
      return plainToInstance(ChatDto, chat.toObject());
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof ForbiddenException
      ) {
        throw error;
      }
      throw logAndThrowError('error in createChat', error);
    }
  }

  /**
   * Get all chats for a project
   */
  async getChatsByProjectId(
    projectId: string,
    userId: string,
  ): Promise<ChatDto[]> {
    try {
      await this.accessService.requireViewer(userId, projectId);

      // Live transcript only. Superseded versions stay in the collection
      // but are reachable solely through the version endpoints.
      const chats = await this.chatModel
        .find({ projectId, active: { $ne: false } })
        .sort({ orderKey: 1 })
        .exec();

      // One extra aggregate gives every bubble its ‹ n/N › denominator
      // without an N+1 of per-message counts.
      const counts = await this.chatModel.aggregate<{
        _id: number;
        count: number;
      }>([
        { $match: { projectId: new Types.ObjectId(projectId) } },
        { $group: { _id: '$orderKey', count: { $sum: 1 } } },
      ]);
      const byOrderKey = new Map(counts.map((c) => [c._id, c.count]));

      return chats.map((chat) => {
        const dto = plainToInstance(ChatDto, chat.toObject());
        dto.versionCount = byOrderKey.get(chat.orderKey) ?? 1;
        return dto;
      });
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof ForbiddenException
      ) {
        throw error;
      }
      throw logAndThrowError('error in getChatsByProjectId', error);
    }
  }

  /**
   * Get a chat by ID. Pass `projectId` (from URL param) to cross-validate
   * that the chat actually belongs to this project — prevents IDOR.
   */
  async getChatById(
    id: string,
    userId: string,
    projectId?: string,
  ): Promise<ChatDto> {
    try {
      const chat = await this.loadChatFor(id, userId, 'viewer', projectId);
      return plainToInstance(ChatDto, chat.toObject());
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof ForbiddenException
      ) {
        throw error;
      }
      throw logAndThrowError('error in getChatById', error);
    }
  }

  /**
   * Update a chat by ID. Pass `projectId` (from URL param) to cross-validate
   * that the chat belongs to this project — prevents IDOR on write paths.
   */
  async updateChat(
    id: string,
    userId: string,
    updateData: UpdateChatDto,
    projectId?: string,
  ): Promise<ChatDto> {
    try {
      const existing = await this.loadChatFor(id, userId, 'editor', projectId);

      // Anti-forgery: a chat's `role` is immutable, and the CONTENT of an
      // assistant turn can never be rewritten through this path — otherwise a
      // caller could edit a real assistant reply (or flip a user turn to
      // assistant) and forge model output into the context of the next AI call.
      // This mirrors the rule `editChat` already enforces. Assistant turns may
      // still have their metadata updated (progress, URLs), which is safe.
      const { role: _ignoredRole, ...rest } = updateData;
      const sanitized: Partial<UpdateChatDto> = { ...rest };
      if (existing.role === 'assistant' && 'message' in sanitized) {
        delete (sanitized as { message?: string }).message;
      }

      const chat = await this.chatModel
        .findByIdAndUpdate(id, { $set: sanitized }, { new: true })
        .exec();
      if (!chat) {
        throw new NotFoundException(`Chat with ID ${id} not found`);
      }
      return plainToInstance(ChatDto, chat.toObject());
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof ForbiddenException
      ) {
        throw error;
      }
      throw logAndThrowError('error in updateChat', error);
    }
  }

  /**
   * Next free transcript position for a project. Spaced by 1000 so a future
   * "insert a message between these two" doesn't need a re-numbering pass.
   * Probes every version, not just active ones, so an archived branch can
   * never collide with a new message.
   */
  private async nextOrderKey(projectId: string): Promise<number> {
    const last = await this.chatModel
      .findOne({ projectId })
      .sort({ orderKey: -1 })
      .select({ orderKey: 1 })
      .lean()
      .exec();
    return (last?.orderKey ?? 0) + 1000;
  }

  /**
   * Archive the live transcript from `orderKey` forward and stamp every
   * archived doc with `supersededBy`. Shared by edit and version-activate:
   * both need "cut the tail off, remember it as one branch".
   */
  private async archiveFrom(
    projectId: string,
    orderKey: number,
    supersededBy: Types.ObjectId,
  ): Promise<number> {
    const res = await this.chatModel
      .updateMany(
        {
          projectId: new Types.ObjectId(projectId),
          active: { $ne: false },
          orderKey: { $gte: orderKey },
          _id: { $ne: supersededBy },
        },
        { $set: { active: false, supersededBy } },
      )
      .exec();
    return res.modifiedCount ?? 0;
  }

  /**
   * Re-run a prompt with corrected wording instead of arguing with it in a
   * follow-up message. Creates a new version of `id` in place (same
   * `orderKey`) and archives everything downstream, so the caller can
   * re-enter the planning pipeline from exactly this point.
   *
   * Only `user` messages are editable — rewriting an assistant turn would
   * let a caller forge model output into the context of the next call.
   */
  async editChat(
    id: string,
    userId: string,
    message: string,
    projectId?: string,
  ): Promise<{ chat: ChatDto; archivedCount: number }> {
    try {
      const original = await this.loadChatFor(id, userId, 'editor', projectId);
      if (original.role !== 'user') {
        throw new BadRequestException('Only user messages can be edited');
      }

      const pid = String(original.projectId);
      const orderKey = original.orderKey ?? 0;

      // Version numbers are per-position and monotonic: an edit of an old
      // version still lands on top of the stack, so `version` never repeats.
      const top = await this.chatModel
        .findOne({ projectId: original.projectId, orderKey })
        .sort({ version: -1 })
        .select({ version: 1 })
        .lean()
        .exec();

      const replacement = await this.chatModel.create({
        projectId: original.projectId,
        message,
        role: 'user',
        messageType: original.messageType,
        metadata: original.metadata,
        orderKey,
        version: (top?.version ?? 1) + 1,
        active: true,
        revisionOf: original._id,
        supersededBy: null,
      });

      const archivedCount = await this.archiveFrom(
        pid,
        orderKey,
        replacement._id as Types.ObjectId,
      );

      // Archiving the transcript is only half the rewind. The questionnaire,
      // stage and lock live on the project, so leaving them alone means the
      // stale questionnaire is restored from `project.questionnaire` on the
      // next page load and the user is answering questions generated for the
      // prompt they just rewrote.
      await this.rewindProjectToConversation(pid);

      return {
        chat: plainToInstance(ChatDto, replacement.toObject()),
        archivedCount,
      };
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof ForbiddenException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }
      throw logAndThrowError('error in editChat', error);
    }
  }

  /**
   * Put a project back at the start of the planning conversation.
   *
   * Called when a prompt is edited or an older version is restored: whatever
   * the AI derived from the previous wording is now stale, so the persisted
   * questionnaire is dropped and the state machine rewinds. `locked` is
   * cleared too — the workspace disables input for any stage past
   * conversation, so a project left locked can be rewound but not re-run.
   */
  private async rewindProjectToConversation(projectId: string): Promise<void> {
    await this.userProjectModel
      .updateOne(
        { _id: new Types.ObjectId(projectId) },
        {
          $set: {
            stage: ProjectStage.CONVERSATION,
            stageStatus: StageStatus.IN_PROGRESS,
            completedStages: [],
            locked: false,
          },
          $unset: { questionnaire: '' },
        },
      )
      .exec();
  }

  /**
   * Every version of one bubble, oldest first — the data behind ‹ 2/3 ›.
   */
  async getChatVersions(
    id: string,
    userId: string,
    projectId?: string,
  ): Promise<ChatDto[]> {
    try {
      const chat = await this.loadChatFor(id, userId, 'viewer', projectId);
      const versions = await this.chatModel
        .find({ projectId: chat.projectId, orderKey: chat.orderKey ?? 0 })
        .sort({ version: 1 })
        .exec();
      return versions.map((v) => plainToInstance(ChatDto, v.toObject()));
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof ForbiddenException
      ) {
        throw error;
      }
      throw logAndThrowError('error in getChatVersions', error);
    }
  }

  /**
   * Swap the transcript back to an older version of a message, restoring
   * the branch that was archived alongside it.
   *
   * The restore is a single query because of how `archiveFrom` stamps:
   * every doc archived by one edit shares that edit's `supersededBy` value,
   * so `{ supersededBy: target.supersededBy }` *is* the branch tail — the
   * target message plus exactly the replies it originally had.
   */
  async activateChatVersion(
    id: string,
    userId: string,
    projectId?: string,
  ): Promise<{ chats: ChatDto[]; archivedCount: number }> {
    try {
      const target = await this.loadChatFor(id, userId, 'editor', projectId);
      if (target.active !== false) {
        // Already the live version — nothing to swap.
        return {
          chats: [plainToInstance(ChatDto, target.toObject())],
          archivedCount: 0,
        };
      }

      const pid = String(target.projectId);
      const branchTag = target.supersededBy ?? null;

      const archivedCount = await this.archiveFrom(
        pid,
        target.orderKey ?? 0,
        target._id as Types.ObjectId,
      );

      const restoreFilter = branchTag
        ? { projectId: target.projectId, supersededBy: branchTag }
        : { projectId: target.projectId, _id: target._id };

      await this.chatModel
        .updateMany(restoreFilter, {
          $set: { active: true, supersededBy: null },
        })
        .exec();

      await this.rewindProjectToConversation(pid);

      const restored = await this.chatModel
        .find({
          projectId: target.projectId,
          active: { $ne: false },
          orderKey: { $gte: target.orderKey ?? 0 },
        })
        .sort({ orderKey: 1 })
        .exec();

      return {
        chats: restored.map((c) => plainToInstance(ChatDto, c.toObject())),
        archivedCount,
      };
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof ForbiddenException
      ) {
        throw error;
      }
      throw logAndThrowError('error in activateChatVersion', error);
    }
  }

  /**
   * Delete a chat by ID. Pass `projectId` (from URL param) to cross-validate
   * that the chat belongs to this project — prevents IDOR on delete paths.
   */
  async deleteChat(
    id: string,
    userId: string,
    projectId?: string,
  ): Promise<void> {
    try {
      await this.loadChatFor(id, userId, 'editor', projectId);
      // Soft-delete: drop the message from the live transcript without
      // hard-deleting it. A hard delete would orphan any `revisionOf` /
      // `supersededBy` pointers on other versions at this position and skew the
      // per-position version count. `active: false` is the same mechanism edit
      // and version-activate already use, and the transcript query filters on
      // it (`active: { $ne: false }`).
      await this.chatModel
        .updateOne({ _id: id }, { $set: { active: false } })
        .exec();
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof ForbiddenException
      ) {
        throw error;
      }
      throw logAndThrowError('error in deleteChat', error);
    }
  }
}
