/**
 * E6 — click-to-edit source annotator.
 *
 * Walks every `.jsx`, `.tsx`, `.js`, `.ts` file in the deploy file
 * map and adds a `data-iyona-src="<file>:<line>:<col>"` attribute to
 * the first lowercase JSX opening tag on each line. The preview-bridge
 * (running inside the deployed iframe) reads that attribute when the
 * user clicks an element with pick-mode enabled and posts the source
 * location back to the Iyona workspace, which pre-fills the chat
 * composer with a context-aware prompt.
 *
 * Why regex and not a full Babel pass?
 *   - The generated apps are tiny enough that a regex pass is fast and
 *     dependency-free, and we already ship them through Vite at the
 *     user's deploy.
 *   - We only need lowercase host tags (`div`, `button`, `h1`, ...).
 *     Component tags (`<Header />`) don't need annotating because the
 *     user can drill in by clicking the rendered host elements they
 *     emit.
 *   - Worst case (regex fails to match) the bridge silently falls back
 *     to "no pick target" — never breaks the deployed app.
 *
 * The injector is idempotent: if a tag already carries a
 * `data-iyona-src` attribute we leave it alone.
 */

// Match lowercase JSX opening tags but NOT TypeScript generics.
// Negative lookbehind rejects `<tag` when preceded by a word char, dot,
// closing paren, or closing bracket — those are generic positions like
// `z.infer<typeof ...>`, `Array<string>`, `foo<bar>`, `(x)<y>`.
const JSX_TAG_RE =
  /(?<![.\w)\]])<([a-z][a-z0-9]*)((?:\s+(?!data-iyona-src=)[a-zA-Z_:][^=>\s]*(?:=(?:"[^"]*"|'[^']*'|\{[^}]*\}))?)*)\s*(\/?)>/g;

const ANNOTATABLE_EXT = new Set(['.jsx', '.tsx']);

function getExt(path: string): string {
  const dot = path.lastIndexOf('.');
  return dot >= 0 ? path.slice(dot).toLowerCase() : '';
}

// PR-2.C — escape attribute values before interpolating user-controlled
// file paths into HTML. Even though `assertSafeRelativePath` rejects
// paths with quotes/angle brackets, an upstream regression here would
// otherwise let a crafted path break out of the attribute and inject
// markup into the deployed page.
function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function annotateFileContents(filePath: string, contents: string): string {
  const safePath = escapeAttr(filePath);
  const lines = contents.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Skip lines with no lowercase-tag-like pattern for speed.
    // The real regex has a lookbehind to avoid TS generics; the
    // quick-check just avoids running the full regex on plain TS lines.
    if (!/<[a-z]/.test(line)) continue;

    let cursor = 0;
    let result = '';
    JSX_TAG_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    let touched = false;

    while ((match = JSX_TAG_RE.exec(line)) !== null) {
      const [full, tag, attrs, selfClose] = match;
      const start = match.index;
      const col = start + 1;
      const attr = ` data-iyona-src="${safePath}:${i + 1}:${col}"`;
      result += line.slice(cursor, start);
      result += `<${tag}${attrs}${attr}${selfClose ? ' /' : ''}>`;
      cursor = start + full.length;
      touched = true;
    }
    if (touched) {
      result += line.slice(cursor);
      lines[i] = result;
    }
  }
  return lines.join('\n');
}

/**
 * Annotate the file map in place (returns a new map). Files that
 * aren't .jsx/.tsx are returned untouched.
 */
export function injectClickToEdit(
  files: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [path, contents] of Object.entries(files)) {
    if (!ANNOTATABLE_EXT.has(getExt(path))) {
      out[path] = contents;
      continue;
    }
    try {
      out[path] = annotateFileContents(path, contents);
    } catch {
      // Annotator must never break the build — fall back to original.
      out[path] = contents;
    }
  }
  return out;
}
