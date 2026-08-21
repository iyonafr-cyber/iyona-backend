import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { Document } from 'mongoose';

/** Project-level collaborator role (not app UserRole). */
export enum ProjectMemberRole {
  USER = 'user',
  ADMIN = 'admin',
}

@Schema({ timestamps: true })
export class ProjectMember extends Document {
  @Prop({
    type: mongoose.Schema.Types.ObjectId,
    ref: 'UserProject',
    required: true,
    index: true,
  })
  projectId: mongoose.Types.ObjectId;

  @Prop({
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  })
  userId: mongoose.Types.ObjectId;

  @Prop({ type: String, required: true, lowercase: true, trim: true })
  email: string;

  @Prop({
    type: String,
    enum: ProjectMemberRole,
    required: true,
  })
  role: ProjectMemberRole;

  @Prop({
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  })
  invitedBy: mongoose.Types.ObjectId;
}

export const ProjectMemberSchema = SchemaFactory.createForClass(ProjectMember);

ProjectMemberSchema.index({ projectId: 1, email: 1 }, { unique: true });

ProjectMemberSchema.index({ projectId: 1, userId: 1 }, { unique: true });
