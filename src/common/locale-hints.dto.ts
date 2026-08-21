import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches } from 'class-validator';

/** BCP-47-style primary tag or short tag with region (en, fr, fr-CA). */
export const JARVIS_LOCALE_TAG_REGEX = /^[a-z]{2}([-_][a-zA-Z0-9]{2,8})?$/;

/**
 * Optional locale hints shared across AI + patch DTOs.
 * Extend this class so class-validator metadata applies to subclasses.
 */
export class LocaleHintsMixin {
  @ApiPropertyOptional({
    description:
      'Jarvis UI language from the client (en or fr today). Used when automatic language detection from text is uncertain.',
    example: 'fr',
  })
  @IsOptional()
  @IsString()
  @Matches(JARVIS_LOCALE_TAG_REGEX, {
    message: 'uiLocale must be a valid language tag (e.g. en, fr)',
  })
  uiLocale?: string;

  @ApiPropertyOptional({
    description:
      'Optional override for conversation locale (BCP-47). When omitted, the server detects language from the main user text.',
    example: 'fr',
  })
  @IsOptional()
  @IsString()
  @Matches(JARVIS_LOCALE_TAG_REGEX, {
    message: 'conversationLocale must be a valid language tag',
  })
  conversationLocale?: string;
}
