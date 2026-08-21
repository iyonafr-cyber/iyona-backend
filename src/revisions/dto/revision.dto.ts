import { ApiProperty } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';
import { RevisionStatus } from '../entities/revision.entity';

@Exclude()
export class RevisionDto {
  @Expose()
  @ApiProperty({ description: 'Revision ID' })
  _id: string;

  @Expose()
  @ApiProperty({ description: 'Project ID' })
  projectId: string;

  @Expose()
  @ApiProperty({ description: 'Version number' })
  version: number;

  @Expose()
  @ApiProperty({ description: 'Number of files in this revision' })
  fileCount: number;

  @Expose()
  @ApiProperty({ description: 'Revision status', enum: RevisionStatus })
  status: RevisionStatus;

  @Expose()
  @ApiProperty({ description: 'Vercel deployment ID', required: false })
  deploymentId?: string;

  @Expose()
  @ApiProperty({ description: 'Vercel deployment URL', required: false })
  deploymentUrl?: string;

  @Expose()
  @ApiProperty({ description: 'Stable preview URL', required: false })
  previewUrl?: string;

  @Expose()
  @ApiProperty({ description: 'Error message if failed', required: false })
  errorMessage?: string;

  @Expose()
  @ApiProperty({ description: 'Commit message', required: false })
  commitMessage?: string;

  @Expose()
  @ApiProperty({ description: 'Created timestamp' })
  createdAt: Date;

  @Expose()
  @ApiProperty({ description: 'Updated timestamp' })
  updatedAt: Date;
}
