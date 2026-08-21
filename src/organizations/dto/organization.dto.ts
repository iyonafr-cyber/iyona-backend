import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Expose, Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class OrganizationDto {
  @ApiProperty()
  @Expose()
  _id!: string;

  @ApiProperty()
  @Expose()
  name!: string;

  @ApiProperty()
  @Expose()
  slug!: string;

  @ApiProperty()
  @Expose()
  ownerId!: string;

  @ApiProperty()
  @Expose()
  isPersonal!: boolean;

  @ApiProperty({ enum: ['free', 'team_starter', 'team_pro'] })
  @Expose()
  plan!: 'free' | 'team_starter' | 'team_pro';

  @ApiProperty({ type: [String] })
  @Expose()
  featureFlags!: string[];

  @ApiProperty()
  @Expose()
  seatCount!: number;

  @ApiPropertyOptional()
  @Expose()
  ssoConnectionId?: string | null;

  /** The caller's role in this org. Only set on /me responses. */
  @ApiPropertyOptional({ enum: ['owner', 'admin', 'member', 'viewer'] })
  @Expose()
  myRole?: 'owner' | 'admin' | 'member' | 'viewer';
}

export class CreateOrganizationDto {
  @ApiProperty({ minLength: 2, maxLength: 80 })
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name!: string;

  @ApiPropertyOptional({
    description:
      'Optional URL-safe slug. Lowercased; defaults to a slugified name.',
  })
  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9-]+$/i, {
    message: 'slug must be alphanumeric with optional hyphens',
  })
  @MaxLength(60)
  slug?: string;
}

export class UpdateOrganizationDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  featureFlags?: string[];
}

export class OrgMemberDto {
  @ApiProperty()
  @Expose()
  _id!: string;

  @ApiProperty()
  @Expose()
  orgId!: string;

  @ApiProperty()
  @Expose()
  userId!: string;

  @ApiProperty({ enum: ['owner', 'admin', 'member', 'viewer'] })
  @Expose()
  role!: 'owner' | 'admin' | 'member' | 'viewer';

  @ApiPropertyOptional()
  @Expose()
  email?: string;

  @ApiPropertyOptional()
  @Expose()
  lastActiveAt?: string | null;
}

export class InviteMemberDto {
  @ApiProperty()
  @IsString()
  email!: string;

  @ApiProperty({ enum: ['admin', 'member', 'viewer'], default: 'member' })
  @IsEnum(['admin', 'member', 'viewer'])
  role!: 'admin' | 'member' | 'viewer';
}

export class UpdateMemberRoleDto {
  @ApiProperty({ enum: ['owner', 'admin', 'member', 'viewer'] })
  @IsEnum(['owner', 'admin', 'member', 'viewer'])
  role!: 'owner' | 'admin' | 'member' | 'viewer';
}

export class SwitchOrganizationDto {
  @ApiProperty()
  @IsString()
  orgId!: string;
}

export class OrganizationListItemDto extends OrganizationDto {
  @ApiProperty()
  @Expose()
  @Type(() => Number)
  memberCount!: number;
}
