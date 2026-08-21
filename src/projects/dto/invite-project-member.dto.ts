import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsEnum, IsNotEmpty } from 'class-validator';
import { ProjectMemberRole } from '../entities/project-member.entity';

export class InviteProjectMemberDto {
  @ApiProperty({ example: 'teammate@example.com' })
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @ApiProperty({ enum: ProjectMemberRole, example: ProjectMemberRole.USER })
  @IsEnum(ProjectMemberRole)
  role: ProjectMemberRole;
}
