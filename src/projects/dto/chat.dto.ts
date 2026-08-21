import { ApiProperty } from '@nestjs/swagger';
import { Expose, Transform } from 'class-transformer';

export class ChatDto {
  @ApiProperty({
    type: String,
    description: 'Chat ID (MongoDB ObjectId)',
    example: '507f1f77bcf86cd799439011',
  })
  @Expose()
  @Transform(({ value }) =>
    value === undefined || value === null ? null : String(value),
  )
  _id: string;

  @ApiProperty({
    type: String,
    description: 'Project ID (MongoDB ObjectId)',
    example: '507f1f77bcf86cd799439011',
  })
  @Expose()
  @Transform(({ value }) =>
    value === undefined || value === null ? null : String(value),
  )
  projectId: string;

  @ApiProperty({
    type: String,
    description: 'Chat message',
    example: 'How do I implement authentication?',
  })
  @Expose()
  @Transform(({ value }) =>
    value === undefined || value === null ? null : value,
  )
  message: string;

  @ApiProperty({
    type: String,
    enum: ['user', 'assistant'],
    description: 'Role of the message sender',
    example: 'user',
  })
  @Expose()
  @Transform(({ value }) =>
    value === undefined || value === null ? 'user' : value,
  )
  role: string;

  @ApiProperty({
    type: Date,
    description: 'Creation timestamp',
  })
  @Expose()
  @Transform(({ value }) =>
    value === undefined || value === null ? null : value,
  )
  createdAt: Date;

  @ApiProperty({
    type: Date,
    description: 'Last update timestamp',
  })
  @Expose()
  @Transform(({ value }) =>
    value === undefined || value === null ? null : value,
  )
  updatedAt: Date;

  @ApiProperty({
    type: String,
    enum: [
      'markdown',
      'deployment',
      'code-generation',
      'questionnaire',
      'execution-plan',
    ],
    description: 'Message type for assistant messages',
    required: false,
  })
  @Expose()
  @Transform(({ value }) =>
    value === undefined || value === null ? null : value,
  )
  messageType?: string;

  @ApiProperty({
    type: Object,
    description: 'Additional metadata for the message (progress, URLs, etc.)',
    required: false,
  })
  @Expose()
  @Transform(({ value }) =>
    value === undefined || value === null ? null : value,
  )
  metadata?: Record<string, any>;

  @ApiProperty({
    type: Number,
    description:
      'Stable transcript position. Every version of a message shares it.',
    example: 3000,
  })
  @Expose()
  @Transform(({ value }) => (typeof value === 'number' ? value : 0))
  orderKey: number;

  @ApiProperty({
    type: Number,
    description: '1-based version at this orderKey',
    example: 1,
  })
  @Expose()
  @Transform(({ value }) => (typeof value === 'number' ? value : 1))
  version: number;

  @ApiProperty({
    type: Boolean,
    description: 'Whether this message is part of the live transcript',
  })
  @Expose()
  @Transform(({ value }) => value !== false)
  active: boolean;

  @ApiProperty({
    type: Number,
    description:
      'How many versions exist at this orderKey. Drives the ‹ 2/3 › picker; ' +
      'only populated on the list endpoint.',
    required: false,
  })
  @Expose()
  @Transform(({ value }) => (typeof value === 'number' ? value : undefined))
  versionCount?: number;
}
