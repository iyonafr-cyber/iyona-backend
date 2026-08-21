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
  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(280)
  description?: string;

  @IsOptional()
  @IsUrl({ require_tld: false })
  ogImage?: string;

  @IsOptional()
  @IsEnum(['summary', 'summary_large_image'])
  twitterCard?: 'summary' | 'summary_large_image';

  @IsOptional()
  @IsBoolean()
  robotsAllow?: boolean;

  @IsOptional()
  @IsUrl({ require_tld: false })
  canonical?: string;
}
