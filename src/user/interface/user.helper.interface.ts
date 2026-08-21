import mongoose, { QueryFilter, ObjectId, PipelineStage } from 'mongoose';
import { CreateUserDto } from '../dto/create-user.dto';
import { UserDto } from '../dto/user.dto';
import { User } from '../entities/user.entity';
import { UserSchemaDto } from '../dto/user-schema.dto';
import { CreateUserSocialDto } from '../dto/create-userGoogle.dto';

export interface IUserHelper {
  findUserPipeLine(
    dto: QueryFilter<User>, // QueryFilter is a type from mongoose
  ): Exclude<PipelineStage, PipelineStage.Merge | PipelineStage.Out>[];
  createUser(dto: CreateUserDto | CreateUserSocialDto): Promise<UserDto>;
  findUser(dto: QueryFilter<UserDto>): Promise<UserDto[]>;
  findUserWithSchema(dto: QueryFilter<UserSchemaDto>): Promise<UserSchemaDto[]>;
  pushSessionId(payload: {
    _id: string;
    sessionId: string;
    maxSessions?: number;
  }): Promise<User | null>;
  removeSessionId(payload: {
    _id: string;
    sessionId: string;
  }): Promise<User | null>;
  rotateSessionId(payload: {
    _id: string;
    oldSessionId: string;
    newSessionId: string;
    maxSessions?: number;
  }): Promise<User | null>;
  updateUser(find: QueryFilter<User>, dto: QueryFilter<User>): Promise<UserDto>;
  findUserById(
    userId: mongoose.Types.ObjectId, // ObjectId is a type from mongoose
  ): Promise<UserDto | null>; // UserDto is a type from the UserDto class
}
