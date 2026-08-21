import { ApiProperty } from '@nestjs/swagger';
import { Expose } from 'class-transformer';
import { ProjectMemberRole } from '../entities/project-member.entity';

export class ProjectMemberRowDto {
  @ApiProperty()
  @Expose()
  _id: string;

  @ApiProperty({ required: false })
  @Expose()
  userId?: string;

  @ApiProperty()
  @Expose()
  email: string;

  @ApiProperty({ enum: ProjectMemberRole, required: false })
  @Expose()
  role?: ProjectMemberRole;

  @ApiProperty({ description: 'owner row or collaborator' })
  @Expose()
  kind: 'owner' | 'member';

  @ApiProperty({ required: false, description: 'Display label for owner row' })
  @Expose()
  label?: string;

  @ApiProperty({ required: false })
  @Expose()
  joinedAt?: string;
}
