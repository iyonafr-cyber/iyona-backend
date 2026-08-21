import { ApiProperty } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
} from 'class-validator';

/**
 * E14 — payload for `PUT /projects/:id/seo`. Persists SEO + share
 * metadata for the deployed app. Applied on the next deploy: meta tags
 * are injected into `index.html` and `robots.txt` / `sitemap.xml` are
 * regenerated.
 */
export class UpdateSeoDto {
  @ApiProperty({ required: false, maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string;

  @ApiProperty({ required: false, maxLength: 280 })
  @IsOptional()
  @IsString()
  @MaxLength(280)
  description?: string;

  @ApiProperty({ required: false, description: 'Absolute URL for og:image.' })
  @IsOptional()
  @IsUrl({ require_tld: false })
  ogImage?: string;

  @ApiProperty({
    required: false,
    enum: ['summary', 'summary_large_image'],
  })
  @IsOptional()
  @IsEnum(['summary', 'summary_large_image'])
  twitterCard?: 'summary' | 'summary_large_image';

  @ApiProperty({
    required: false,
    description: 'When false, emits noindex meta + Disallow: / in robots.txt.',
  })
  @IsOptional()
  @IsBoolean()
  robotsAllow?: boolean;

  @ApiProperty({ required: false, description: 'Override canonical URL.' })
  @IsOptional()
  @IsUrl({ require_tld: false })
  canonical?: string;
}
