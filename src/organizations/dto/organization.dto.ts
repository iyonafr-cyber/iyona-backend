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
  @Expose()
  _id!: string;

  @Expose()
  name!: string;

  @Expose()
  slug!: string;

  @Expose()
  ownerId!: string;

  @Expose()
  isPersonal!: boolean;

  @Expose()
  plan!: 'free' | 'team_starter' | 'team_pro';

  @Expose()
  featureFlags!: string[];

  @Expose()
  seatCount!: number;

  @Expose()
  ssoConnectionId?: string | null;

  /** The caller's role in this org. Only set on /me responses. */
  @Expose()
  myRole?: 'owner' | 'admin' | 'member' | 'viewer';
}

export class CreateOrganizationDto {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name!: string;

  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9-]+$/i, {
    message: 'slug must be alphanumeric with optional hyphens',
  })
  @MaxLength(60)
  slug?: string;
}

export class UpdateOrganizationDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsArray()
  featureFlags?: string[];
}

export class OrgMemberDto {
  @Expose()
  _id!: string;

  @Expose()
  orgId!: string;

  @Expose()
  userId!: string;

  @Expose()
  role!: 'owner' | 'admin' | 'member' | 'viewer';

  @Expose()
  email?: string;

  @Expose()
  lastActiveAt?: string | null;
}

export class InviteMemberDto {
  @IsString()
  email!: string;

  @IsEnum(['admin', 'member', 'viewer'])
  role!: 'admin' | 'member' | 'viewer';
}

export class UpdateMemberRoleDto {
  @IsEnum(['owner', 'admin', 'member', 'viewer'])
  role!: 'owner' | 'admin' | 'member' | 'viewer';
}

export class SwitchOrganizationDto {
  @IsString()
  orgId!: string;
}

export class OrganizationListItemDto extends OrganizationDto {
  @Expose()
  @Type(() => Number)
  memberCount!: number;
}
