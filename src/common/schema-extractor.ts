import { IyonaSchemaDeclaration } from '../supabase/interface/supabase-schema.interface';

/**
 * Extract a ===SCHEMA=== ... ===END_SCHEMA=== JSON block from AI
 * generation output. Returns null if no schema block is found or if
 * the JSON is malformed.
 */
export function extractSchemaDeclaration(
  output: string,
): IyonaSchemaDeclaration | null {
  const startMarker = '===SCHEMA===';
  const endMarker = '===END_SCHEMA===';

  const startIdx = output.indexOf(startMarker);
  if (startIdx === -1) return null;

  const jsonStart = startIdx + startMarker.length;
  const endIdx = output.indexOf(endMarker, jsonStart);
  if (endIdx === -1) return null;

  const raw = output.substring(jsonStart, endIdx).trim();
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as IyonaSchemaDeclaration;

    // Basic validation
    if (!parsed.version || !Array.isArray(parsed.tables)) return null;
    if (parsed.tables.length === 0) return null;

    for (const table of parsed.tables) {
      if (!table.name || !Array.isArray(table.columns)) return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

/**
 * Strip the ===SCHEMA=== block from the AI output so it doesn't
 * get saved as a file in the revision.
 */
export function stripSchemaBlock(output: string): string {
  const startMarker = '===SCHEMA===';
  const endMarker = '===END_SCHEMA===';

  const startIdx = output.indexOf(startMarker);
  if (startIdx === -1) return output;

  const endIdx = output.indexOf(endMarker, startIdx);
  if (endIdx === -1) return output;

  return (
    output.substring(0, startIdx).trimEnd() +
    '\n' +
    output.substring(endIdx + endMarker.length).trimStart()
  );
}
