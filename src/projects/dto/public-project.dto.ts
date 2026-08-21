import { ApiProperty } from '@nestjs/swagger';
import { Expose, Transform } from 'class-transformer';
import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';

/**
 * Body for `PUT /projects/:id/public`. The project owner uses this
 * endpoint to publish / unpublish a project and tweak the marketing
 * copy that appears on the public landing page.
 */
export class SetPublicProjectDto {
  @ApiProperty({ type: Boolean, example: true })
  @IsBoolean()
  isPublic: boolean;

  @ApiProperty({
    type: String,
    required: false,
    description:
      'Short marketing blurb shown on the /p/:slug page. Required when isPublic is true. ' +
      'We do NOT fall back to initialPrompt — that may contain secrets or PII.',
    maxLength: 500,
  })
  // Required when publishing (isPublic === true); ignored when unpublishing.
  // @ValidateIf already handles the conditional — do NOT add @IsOptional here
  // because it would silently skip @IsNotEmpty when the value is undefined.
  @ValidateIf((o: SetPublicProjectDto) => o.isPublic === true)
  @IsString()
  @IsNotEmpty({ message: 'publicSummary is required when publishing publicly' })
  @MaxLength(500)
  publicSummary?: string;
}

/**
 * Body for `POST /projects/:id/remix`. Auth required. Creates a new
 * project owned by the caller, with `remixOf` set to the source.
 */
export class RemixProjectDto {
  @ApiProperty({
    type: String,
    required: false,
    description:
      'Optional override prompt. When omitted, the source project initial prompt is reused.',
  })
  @IsOptional()
  @IsString()
  initialPrompt?: string;

  @ApiProperty({ type: String, required: false })
  @IsOptional()
  @IsString()
  name?: string;
}

/**
 * Wire-safe view of a public project. NEVER includes owner email,
 * Supabase keys, payment config, or any other private field. This is
 * the only DTO returned by the unauthenticated `/public/*` endpoints.
 */
export class PublicProjectDto {
  @ApiProperty({ type: String })
  @Expose()
  @Transform(({ value }) =>
    value === undefined || value === null ? null : String(value),
  )
  _id: string;

  @ApiProperty({ type: String, required: false })
  @Expose()
  name?: string;

  @ApiProperty({ type: String })
  @Expose()
  publicSlug: string;

  /**
   * Required marketing blurb shown on the public landing page. Project
   * owners are forced to write one before publishing — we DO NOT fall
   * back to `initialPrompt` because that prompt may contain secrets,
   * private business context, or PII the owner never intended to expose
   * to the world.
   */
  @ApiProperty({ type: String })
  @Expose()
  publicSummary: string;

  @ApiProperty({ type: String, required: false })
  @Expose()
  previewUrl?: string;

  @ApiProperty({ type: Boolean })
  @Expose()
  isTemplate: boolean;

  @ApiProperty({ type: String, required: false })
  @Expose()
  templateCategory?: string;

  @ApiProperty({ type: Number })
  @Expose()
  remixCount: number;

  @ApiProperty({
    type: String,
    required: false,
    description: 'Display name of the project owner (or "Anonymous").',
  })
  @Expose()
  ownerDisplayName?: string;

  @ApiProperty({ type: Date })
  @Expose()
  createdAt: Date;
}
