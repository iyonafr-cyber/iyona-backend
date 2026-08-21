import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { User } from '../entities/user.entity';
import { IUserHelper } from '../interface/user.helper.interface';
import mongoose, { QueryFilter, Model, PipelineStage } from 'mongoose';
import { UserDto } from '../dto/user.dto';
import { CreateUserDto } from '../dto/create-user.dto';
import { plainToInstance } from 'class-transformer';
import { UserSchemaDto } from '../dto/user-schema.dto';
import { CreateUserSocialDto } from '../dto/create-userGoogle.dto';

@Injectable()
export class UserHelper implements IUserHelper {
  constructor(@InjectModel(User.name) private userModel: Model<User>) {}

  findUserPipeLine(
    dto: QueryFilter<User>,
  ): Exclude<PipelineStage, PipelineStage.Merge | PipelineStage.Out>[] {
    const pipeline: Exclude<
      PipelineStage,
      PipelineStage.Merge | PipelineStage.Out
    >[] = [
      {
        $match: {
          ...dto,
        },
      },
    ];
    return pipeline;
  }

  // create user
  async createUser(dto: CreateUserDto | CreateUserSocialDto): Promise<UserDto> {
    // Ensure isDeleted is always false on sign up
    const user = await this.userModel.create({ ...dto, isDeleted: false });
    return plainToInstance(UserDto, user.toObject());
  }

  // find multiple users with schema
  async findUser(dto: QueryFilter<UserDto>): Promise<UserDto[]> {
    // Convert DTO filter to User filter, handling _id conversion from string to ObjectId
    const userFilter: any = { ...dto };
    if (dto._id && typeof dto._id === 'string') {
      userFilter._id = new mongoose.Types.ObjectId(dto._id);
    }
    const pipeline = this.findUserPipeLine(userFilter as QueryFilter<User>);
    const users: UserDto[] = await this.userModel.aggregate(pipeline).exec();
    return users.map((item) => {
      return plainToInstance(UserDto, item);
    });
  }

  // find multiple users with schema
  async findUserWithSchema(
    dto: QueryFilter<UserSchemaDto>,
  ): Promise<UserSchemaDto[]> {
    const users = await this.userModel.find({
      ...(dto as QueryFilter<User>),
      $or: [{ isDeleted: { $ne: true } }, { isDeleted: { $exists: false } }],
    });
    return users.map((item) => {
      return plainToInstance(UserSchemaDto, item.toObject());
    });
  }

  /**
   * Append a session id, capping the array at `maxSessions` (FIFO). Uses
   * `$push` with `$slice` so the cap is enforced atomically in MongoDB.
   */
  async pushSessionId(payload: {
    _id: string;
    sessionId: string;
    maxSessions?: number;
  }): Promise<User | null> {
    const maxSessions = payload.maxSessions ?? 10;
    return this.userModel.findOneAndUpdate(
      { _id: payload._id },
      {
        $push: {
          sessionIds: {
            $each: [payload.sessionId],
            $slice: -maxSessions,
          },
        },
      },
      { new: true },
    );
  }

  async removeSessionId(payload: {
    _id: string;
    sessionId: string;
  }): Promise<User | null> {
    return this.userModel.findOneAndUpdate(
      { _id: payload._id },
      { $pull: { sessionIds: payload.sessionId } },
      { new: true },
    );
  }

  /**
   * Atomically swap one session id for another using a MongoDB aggregation
   * pipeline update so both the removal of the old id, the addition of the
   * new id, and the FIFO cap all happen in a single write. Requires the
   * `oldSessionId` to currently exist — otherwise the update matches nothing
   * and the caller must treat the rotation as failed (session revoked).
   */
  async rotateSessionId(payload: {
    _id: string;
    oldSessionId: string;
    newSessionId: string;
    maxSessions?: number;
  }): Promise<User | null> {
    const maxSessions = payload.maxSessions ?? 10;
    return this.userModel.findOneAndUpdate(
      { _id: payload._id, sessionIds: payload.oldSessionId },
      [
        {
          $set: {
            sessionIds: {
              $let: {
                vars: {
                  filtered: {
                    $filter: {
                      input: { $ifNull: ['$sessionIds', []] },
                      cond: { $ne: ['$$this', payload.oldSessionId] },
                    },
                  },
                },
                in: {
                  $slice: [
                    {
                      $concatArrays: ['$$filtered', [payload.newSessionId]],
                    },
                    -maxSessions,
                  ],
                },
              },
            },
          },
        },
      ],
      { new: true },
    );
  }

  // update user
  async updateUser(
    find: QueryFilter<User>,
    dto: QueryFilter<User>,
  ): Promise<UserDto> {
    const updatedUser = await this.userModel.findOneAndUpdate(
      find,
      { $set: dto },
      { new: true },
    );
    const pipeline = this.findUserPipeLine({ _id: updatedUser?._id });
    const [user] = await this.userModel.aggregate(pipeline).exec();

    return plainToInstance(UserDto, user);
  }

  // find user by id
  async findUserById(userId: mongoose.Types.ObjectId): Promise<UserDto | null> {
    const pipeline = this.findUserPipeLine({ _id: userId });
    const users = await this.userModel.aggregate(pipeline).exec();
    if (users.length === 0) return null;
    return plainToInstance(UserDto, users[0]);
  }
}
