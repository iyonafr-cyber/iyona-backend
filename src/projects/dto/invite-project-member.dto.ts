import { IsEmail, IsEnum, IsNotEmpty } from 'class-validator';
import { ProjectMemberRole } from '../entities/project-member.entity';

export class InviteProjectMemberDto {
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @IsEnum(ProjectMemberRole)
  role: ProjectMemberRole;
}
