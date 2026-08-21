import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { Document } from 'mongoose';

@Schema({ timestamps: true })
export class GitHubIntegration extends Document {
  @Prop({
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  })
  userId: mongoose.Types.ObjectId;

  @Prop({ type: String, required: true, unique: true, index: true })
  githubUsername: string;

  @Prop({ type: String, required: true })
  accessToken: string; // Encrypted access token

  @Prop({ type: String })
  refreshToken?: string;

  @Prop({ type: Date })
  tokenExpiresAt?: Date;

  @Prop({ type: [String], default: [] })
  repositoryIds: string[]; // Array of repository IDs/names

  @Prop({ type: Boolean, default: true })
  isActive: boolean;

  @Prop({ type: Object })
  metadata?: {
    avatarUrl?: string;
    email?: string;
    name?: string;
    bio?: string;
  };
}

export const GitHubIntegrationSchema =
  SchemaFactory.createForClass(GitHubIntegration);
