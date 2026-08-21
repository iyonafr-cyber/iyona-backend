/**
 * Generates a full 11-shade Tailwind-style color palette (50–950) from a
 * single base hex color. Uses HSL interpolation: the base color becomes the
 * 500 shade, lighter shades raise lightness toward white, darker shades
 * lower lightness toward near-black.
 *
 * The output is keyed by Tailwind shade number as strings: "50"–"950".
 */

// ── Hex ↔ HSL helpers ──────────────────────────────────────────────────

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return [h, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [
    Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
    Math.round(hue2rgb(p, q, h) * 255),
    Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
  ];
}

function rgbToHex(r: number, g: number, b: number): string {
  return (
    '#' +
    [r, g, b]
      .map((v) =>
        Math.max(0, Math.min(255, v))
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
  );
}

// ── Target lightness values per shade (empirical, matching Tailwind) ────

const SHADE_LIGHTNESS: Record<string, number> = {
  '50':  0.97,
  '100': 0.94,
  '200': 0.86,
  '300': 0.76,
  '400': 0.64,
  '500': 0.50,   // base
  '600': 0.42,
  '700': 0.34,
  '800': 0.26,
  '900': 0.20,
  '950': 0.12,
};

export const SHADE_KEYS = Object.keys(SHADE_LIGHTNESS);

/**
 * Generate a full palette from a single hex color.
 * The base hex is mapped to shade 500; other shades are produced by
 * adjusting lightness in HSL while preserving hue and slightly adjusting
 * saturation (lighter shades desaturate slightly for a more natural look).
 */
export function generatePalette(baseHex: string): Record<string, string> {
  const [r, g, b] = hexToRgb(baseHex);
  const [h, s] = rgbToHsl(r, g, b);

  const palette: Record<string, string> = {};
  for (const [shade, targetL] of Object.entries(SHADE_LIGHTNESS)) {
    // Slightly desaturate lighter shades, saturate darker ones
    const satAdj =
      targetL > 0.5
        ? s * (0.6 + 0.4 * ((1 - targetL) / 0.5)) // lighter → less saturated
        : s * (0.85 + 0.15 * ((0.5 - targetL) / 0.5)); // darker → slightly more
    const [rr, gg, bb] = hslToRgb(h, Math.min(1, satAdj), targetL);
    palette[shade] = rgbToHex(rr, gg, bb);
  }
  // Override 500 with the exact input color for fidelity
  palette['500'] = baseHex.startsWith('#') ? baseHex : `#${baseHex}`;

  return palette;
}

/**
 * Convenience: generate all three kit palettes from a `RepoDesignSystem.colors`
 * object. Falls back to defaults from ui-kit.constants when a color is missing.
 */
export function palettesFromDesignSystem(colors: {
  primary?: string;
  accent?: string;
  background?: string;
  foreground?: string;
} | null | undefined): {
  primary?: Record<string, string>;
  secondary?: Record<string, string>;
  accent?: Record<string, string>;
} | undefined {
  if (!colors) return undefined;

  const out: {
    primary?: Record<string, string>;
    secondary?: Record<string, string>;
    accent?: Record<string, string>;
  } = {};

  if (colors.primary) out.primary = generatePalette(colors.primary);
  if (colors.accent) out.accent = generatePalette(colors.accent);

  // The questionnaire provides `background` + `foreground` which map to the
  // surface/secondary palette. We use `foreground` as the secondary base
  // (it's usually a dark neutral) and let the shade generator expand it.
  if (colors.foreground) out.secondary = generatePalette(colors.foreground);

  return Object.keys(out).length > 0 ? out : undefined;
}
