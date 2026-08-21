/**
 * Pre-build lint for the ENTITY FIELD CONTRACT the brain writes into section 6
 * of the development plan.
 *
 * Catching field drift in the PLAN costs one amendment call. Catching it after
 * the Cursor build costs a full agent round plus a redeploy, and catching it in
 * production costs the user's trust — an "Add car" form that collects three of
 * the six fields its own cards render.
 *
 * Everything here is heuristic markdown parsing, so it follows the same rule as
 * the code-level gate: only report a violation when the parse is unambiguous.
 * Silence is always preferred over a false amendment.
 */

/** One entity's field table, as declared in the plan. */
export interface PlanEntityContract {
  name: string;
  /** Fields a person fills in on a create/edit form. */
  userFields: string[];
  /** Fields the app generates (id, createdAt, computed counts). */
  systemFields: string[];
}

export interface EntityContractViolation {
  entity: string;
  /** `user` fields the plan's create/edit form list never mentions. */
  missingFromForm: string[];
  /** True when the plan declares the entity but no form field list at all. */
  formFieldsUndeclared: boolean;
}

/** `| image | string | yes | user |` — the contract row shape. */
const CONTRACT_ROW_RE = /^\s*\|([^|]+)\|([^|]+)\|([^|]+)\|([^|]+)\|/;

/** `- **Fields**: image (URL), title (text), …` */
const FORM_FIELDS_RE =
  /^\s*(?:[-*]\s*)?\*{0,2}Fields\*{0,2}\s*(?:\([^)]*\))?\s*:\s*(.+)$/i;

/**
 * Connector and control words that are never field names. Deliberately short:
 * the control type is stripped structurally (from the parenthetical), so words
 * like `image`, `url`, `date` and `file` stay eligible — they are far more
 * often real field names than control annotations.
 */
const FORM_NOISE = new Set([
  'text',
  'textarea',
  'number',
  'select',
  'input',
  'checkbox',
  'radio',
  'dropdown',
  'toggle',
  'string',
  'boolean',
  'required',
  'optional',
  'field',
  'fields',
  'form',
  'and',
  'or',
  'the',
  'a',
  'an',
  'with',
  'for',
  'of',
  'per',
  'each',
  'all',
  'same',
  'as',
  'in',
  'on',
  'to',
]);

/**
 * Field names from a plan field list written as `name (control type), …`.
 * The parenthetical is dropped first so a control annotation can never be
 * mistaken for — or mask — a field name.
 */
function extractFieldNames(text: string): string[] {
  const out: string[] = [];
  for (const rawPart of text.split(',')) {
    const part = rawPart
      .replace(/\([^)]*\)/g, ' ')
      .replace(/[*`]/g, '')
      .trim();
    if (!part) continue;
    const m = /\b([a-z][a-zA-Z0-9_]*)\b/.exec(part);
    if (!m) continue;
    if (FORM_NOISE.has(m[1].toLowerCase())) continue;
    out.push(m[1]);
  }
  return out;
}

/**
 * Pull every entity field table out of the plan. The entity's name is taken
 * from the nearest non-table line above the table — where the brain writes the
 * entity heading.
 */
export function parsePlanEntityContracts(brief: string): PlanEntityContract[] {
  const lines = (brief || '').split('\n');
  const contracts: PlanEntityContract[] = [];

  let current: PlanEntityContract | null = null;
  let inTable = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const row = CONTRACT_ROW_RE.exec(line);
    const source = row ? row[4].trim().toLowerCase() : '';
    const isContractRow = !!row && (source === 'user' || source === 'system');

    if (!isContractRow) {
      // A non-contract line closes the current table.
      if (inTable && current) {
        if (current.userFields.length > 0) contracts.push(current);
        current = null;
      }
      inTable = false;
      continue;
    }

    if (!inTable) {
      // Opening row — look back for the entity name.
      const name = findEntityNameAbove(lines, i);
      if (!name) continue; // unnamed table → cannot attribute, stay silent
      current = { name, userFields: [], systemFields: [] };
      inTable = true;
    }

    if (!current) continue;
    const field = row![1].trim().replace(/[`*]/g, '');
    // Skip the header row (`| field | type | required | source |`).
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(field)) continue;
    if (field.toLowerCase() === 'field') continue;
    if (source === 'user') current.userFields.push(field);
    else current.systemFields.push(field);
  }

  if (inTable && current && current.userFields.length > 0) {
    contracts.push(current);
  }

  return contracts;
}

/** Nearest capitalised entity label in the ~6 lines above a table. */
function findEntityNameAbove(lines: string[], tableStart: number): string {
  for (let i = tableStart - 1; i >= 0 && i >= tableStart - 6; i--) {
    const raw = lines[i].trim();
    if (!raw) continue;
    if (raw.startsWith('|')) continue; // header/separator row
    const cleaned = raw.replace(/[#*_`]/g, '').trim();
    // First capitalised word — "Car", "### Car entity", "**Car** — the listing".
    const m = /\b([A-Z][a-zA-Z0-9]{1,29})\b/.exec(cleaned);
    if (m) return m[1];
  }
  return '';
}

/** A create/edit form field list found in the plan, with its nearby context. */
interface PlanFormFieldList {
  fields: string[];
  /** The ~15 lines above it — the page subsection naming route + component. */
  context: string;
}

function parsePlanFormFieldLists(brief: string): PlanFormFieldList[] {
  const lines = (brief || '').split('\n');
  const out: PlanFormFieldList[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = FORM_FIELDS_RE.exec(lines[i]);
    if (!m) continue;
    const fields = extractFieldNames(m[1]);
    if (fields.length === 0) continue;
    out.push({
      fields,
      context: lines.slice(Math.max(0, i - 15), i).join('\n'),
    });
  }
  return out;
}

/** Does the plan describe a create/edit screen for this entity? */
function planHasWriteScreenFor(brief: string, entity: string): boolean {
  const name = entity.toLowerCase();
  for (const line of (brief || '').split('\n')) {
    const lower = line.toLowerCase();
    if (!lower.includes(name)) continue;
    if (/\b(add|new|create|edit|update)\b/.test(lower)) return true;
  }
  return false;
}

/**
 * Compare each entity's `user` fields against the create/edit form field list
 * the plan declares for it.
 *
 * A form is matched to an entity only when exactly ONE known entity name
 * appears in its page subsection — ambiguity yields no verdict.
 */
export function lintPlanEntityContracts(
  brief: string,
): EntityContractViolation[] {
  const contracts = parsePlanEntityContracts(brief);
  if (contracts.length === 0) return [];

  const formLists = parsePlanFormFieldLists(brief);
  const violations: EntityContractViolation[] = [];

  for (const entity of contracts) {
    const name = entity.name.toLowerCase();

    const matching = formLists.filter((f) => {
      const ctx = f.context.toLowerCase();
      if (!ctx.includes(name)) return false;
      // Reject when another entity also appears — we cannot attribute it.
      const others = contracts.filter(
        (c) => c.name !== entity.name && ctx.includes(c.name.toLowerCase()),
      );
      return others.length === 0;
    });

    if (matching.length === 0) {
      // Only a problem when the plan clearly has a write screen for it.
      if (planHasWriteScreenFor(brief, entity.name)) {
        violations.push({
          entity: entity.name,
          missingFromForm: entity.userFields,
          formFieldsUndeclared: true,
        });
      }
      continue;
    }

    // Union across the create AND edit forms — both must cover the contract,
    // so a field present in either is enough to clear it here; the prompt
    // handles the create/edit symmetry.
    const declared = new Set(
      matching.flatMap((f) => f.fields.map((x) => x.toLowerCase())),
    );
    const missing = entity.userFields.filter(
      (f) => !declared.has(f.toLowerCase()),
    );
    if (missing.length > 0) {
      violations.push({
        entity: entity.name,
        missingFromForm: missing,
        formFieldsUndeclared: false,
      });
    }
  }

  return violations;
}

/** Amendment instructions for the plan-repair call. */
export function formatEntityViolationsForRepair(
  violations: EntityContractViolation[],
): string[] {
  const lines: string[] = [];
  for (const v of violations) {
    if (v.formFieldsUndeclared) {
      lines.push(
        `  - ${v.entity}: the plan has a create/edit screen but never lists its form fields. ` +
          `Add a "**Fields**:" line to that page's section-5 subsection naming every \`user\` field ` +
          `(${v.missingFromForm.join(', ')}) with its control type.`,
      );
      continue;
    }
    lines.push(
      `  - ${v.entity}: the create/edit form omits ${v.missingFromForm.join(', ')} — ` +
        `every field marked \`user\` in the ${v.entity} table must have a form input. ` +
        `Add them to the page's "**Fields**:" line using the same field names.`,
    );
  }
  return lines;
}
