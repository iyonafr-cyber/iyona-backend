import { IsOptional, IsString, Matches } from 'class-validator';

/** BCP-47-style primary tag or short tag with region (en, fr, fr-CA). */
export const IYONA_LOCALE_TAG_REGEX = /^[a-z]{2}([-_][a-zA-Z0-9]{2,8})?$/;

/**
 * Optional locale hints shared across AI + patch DTOs.
 * Extend this class so class-validator metadata applies to subclasses.
 */
export class LocaleHintsMixin {
  @IsOptional()
  @IsString()
  @Matches(IYONA_LOCALE_TAG_REGEX, {
    message: 'uiLocale must be a valid language tag (e.g. en, fr)',
  })
  uiLocale?: string;

  @IsOptional()
  @IsString()
  @Matches(IYONA_LOCALE_TAG_REGEX, {
    message: 'conversationLocale must be a valid language tag',
  })
  conversationLocale?: string;
}
