import { Expose, Transform } from 'class-transformer';

export class ChatDto {
  @Expose()
  @Transform(({ value }) =>
    value === undefined || value === null ? null : String(value),
  )
  _id: string;

  @Expose()
  @Transform(({ value }) =>
    value === undefined || value === null ? null : String(value),
  )
  projectId: string;

  @Expose()
  @Transform(({ value }) =>
    value === undefined || value === null ? null : value,
  )
  message: string;

  @Expose()
  @Transform(({ value }) =>
    value === undefined || value === null ? 'user' : value,
  )
  role: string;

  @Expose()
  @Transform(({ value }) =>
    value === undefined || value === null ? null : value,
  )
  createdAt: Date;

  @Expose()
  @Transform(({ value }) =>
    value === undefined || value === null ? null : value,
  )
  updatedAt: Date;

  @Expose()
  @Transform(({ value }) =>
    value === undefined || value === null ? null : value,
  )
  messageType?: string;

  @Expose()
  @Transform(({ value }) =>
    value === undefined || value === null ? null : value,
  )
  metadata?: Record<string, any>;

  @Expose()
  @Transform(({ value }) => (typeof value === 'number' ? value : 0))
  orderKey: number;

  @Expose()
  @Transform(({ value }) => (typeof value === 'number' ? value : 1))
  version: number;

  @Expose()
  @Transform(({ value }) => value !== false)
  active: boolean;

  @Expose()
  @Transform(({ value }) => (typeof value === 'number' ? value : undefined))
  versionCount?: number;
}
