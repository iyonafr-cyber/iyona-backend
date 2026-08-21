/**
 * E14 — SEO + social-share injector.
 *
 * Run from `vercel.service.ts` right after the preview-bridge is
 * injected and before the file map is shipped to Vercel. Patches
 * `index.html` with `<title>` + meta tags, and writes `robots.txt`
 * and `sitemap.xml` based on the project's persisted SEO config.
 *
 * Idempotent: replaces any existing Iyona-managed SEO block so
 * toggling provider settings between deploys doesn't pile up stale
 * tags.
 */

export interface SeoInjectorOptions {
  /** Project name — used as the title fallback. */
  projectName?: string;
  /** Public preview URL the deploy will serve from (no trailing slash). */
  siteUrl?: string;
  config?: {
    title?: string;
    description?: string;
    ogImage?: string;
    twitterCard?: 'summary' | 'summary_large_image';
    robotsAllow?: boolean;
    canonical?: string;
  };
}

const SEO_BLOCK_START = '<!-- iyona:seo -->';
const SEO_BLOCK_END = '<!-- /iyona:seo -->';

function escapeAttr(v: string): string {
  return v
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function buildSeoBlock(opts: SeoInjectorOptions): string {
  const cfg = opts.config ?? {};
  const title = (cfg.title || opts.projectName || '').trim();
  const description = (cfg.description || '').trim();
  const canonical = (cfg.canonical || opts.siteUrl || '').trim();
  const ogImage = (cfg.ogImage || '').trim();
  const robotsAllow = cfg.robotsAllow !== false;
  const twitterCard =
    cfg.twitterCard || (ogImage ? 'summary_large_image' : 'summary');

  const tags: string[] = [SEO_BLOCK_START];
  if (title) {
    tags.push(`    <title>${escapeAttr(title)}</title>`);
    tags.push(
      `    <meta property="og:title" content="${escapeAttr(title)}" />`,
    );
    tags.push(
      `    <meta name="twitter:title" content="${escapeAttr(title)}" />`,
    );
  }
  if (description) {
    tags.push(
      `    <meta name="description" content="${escapeAttr(description)}" />`,
    );
    tags.push(
      `    <meta property="og:description" content="${escapeAttr(description)}" />`,
    );
    tags.push(
      `    <meta name="twitter:description" content="${escapeAttr(description)}" />`,
    );
  }
  if (canonical) {
    tags.push(`    <link rel="canonical" href="${escapeAttr(canonical)}" />`);
    tags.push(
      `    <meta property="og:url" content="${escapeAttr(canonical)}" />`,
    );
  }
  if (ogImage) {
    tags.push(
      `    <meta property="og:image" content="${escapeAttr(ogImage)}" />`,
    );
    tags.push(
      `    <meta name="twitter:image" content="${escapeAttr(ogImage)}" />`,
    );
  }
  tags.push(`    <meta name="twitter:card" content="${twitterCard}" />`);
  if (!robotsAllow) {
    tags.push('    <meta name="robots" content="noindex,nofollow" />');
  }
  tags.push(SEO_BLOCK_END);
  return tags.join('\n');
}

function buildRobotsTxt(opts: SeoInjectorOptions): string {
  const allow = opts.config?.robotsAllow !== false;
  const lines = ['User-agent: *', allow ? 'Allow: /' : 'Disallow: /'];
  if (allow && opts.siteUrl) {
    lines.push(`Sitemap: ${opts.siteUrl.replace(/\/$/, '')}/sitemap.xml`);
  }
  return lines.join('\n') + '\n';
}

function buildSitemapXml(opts: SeoInjectorOptions): string {
  const url = (opts.siteUrl || '').replace(/\/$/, '');
  if (!url) {
    return (
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>\n'
    );
  }
  const today = new Date().toISOString().slice(0, 10);
  // PR-2.C — escape `siteUrl` before interpolating into XML.
  // Today the value is set by the platform (Vercel preview URL or
  // verified custom domain) so escaping is defence in depth, but
  // any `&`, `<` or `>` that slips into the value would otherwise
  // produce invalid XML and break sitemap consumers.
  const safeUrl = escapeAttr(url);
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    `  <url>\n    <loc>${safeUrl}/</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>weekly</changefreq>\n  </url>\n` +
    '</urlset>\n'
  );
}

/**
 * Patch `index.html` with the Iyona SEO block (replacing any prior
 * one) and write `robots.txt` + `sitemap.xml` into the file map.
 * Returns the (possibly modified) file map. Safe to call repeatedly.
 */
export function injectSeo(
  files: Record<string, string>,
  options: SeoInjectorOptions,
): Record<string, string> {
  const updated = { ...files };

  const indexKey = Object.keys(updated).find(
    (p) =>
      p === 'index.html' || p === '/index.html' || p.endsWith('/index.html'),
  );
  if (indexKey) {
    let html = updated[indexKey];

    // Drop any prior managed block so we never pile up stale tags.
    const blockRe = new RegExp(
      `${SEO_BLOCK_START}[\\s\\S]*?${SEO_BLOCK_END}\\n?`,
      'g',
    );
    html = html.replace(blockRe, '');

    const block = buildSeoBlock(options) + '\n  ';
    html = html.includes('</head>')
      ? html.replace('</head>', `${block}</head>`)
      : html.includes('</body>')
        ? html.replace('</body>', `${block}</body>`)
        : `${html}\n${block}`;
    updated[indexKey] = html;
  }

  // robots.txt + sitemap.xml live in `public/` so Vite ships them at
  // the build root. We always overwrite — these files are entirely
  // managed by the platform.
  updated['public/robots.txt'] = buildRobotsTxt(options);
  updated['public/sitemap.xml'] = buildSitemapXml(options);

  return updated;
}
