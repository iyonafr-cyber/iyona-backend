import { Exclude, Expose } from 'class-transformer';
import { RevisionStatus } from '../entities/revision.entity';

@Exclude()
export class RevisionDto {
  @Expose()
  _id: string;

  @Expose()
  projectId: string;

  @Expose()
  version: number;

  @Expose()
  fileCount: number;

  @Expose()
  status: RevisionStatus;

  @Expose()
  deploymentId?: string;

  @Expose()
  deploymentUrl?: string;

  @Expose()
  previewUrl?: string;

  @Expose()
  errorMessage?: string;

  @Expose()
  commitMessage?: string;

  @Expose()
  createdAt: Date;

  @Expose()
  updatedAt: Date;
}
