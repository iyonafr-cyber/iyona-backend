import { Expose } from 'class-transformer';
import { ProjectMemberRole } from '../entities/project-member.entity';

export class ProjectMemberRowDto {
  @Expose()
  _id: string;

  @Expose()
  userId?: string;

  @Expose()
  email: string;

  @Expose()
  role?: ProjectMemberRole;

  @Expose()
  kind: 'owner' | 'member';

  @Expose()
  label?: string;

  @Expose()
  joinedAt?: string;
}
