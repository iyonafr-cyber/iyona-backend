/**
 * Declarative schema format emitted by the AI during code generation.
 * The AI outputs this JSON block; the backend parses it and applies it
 * to the Supabase project via the Management API SQL endpoint.
 *
 * Design goals:
 *   - AI-friendly (simple JSON, no raw SQL to hallucinate)
 *   - Backend can enforce RLS automatically
 *   - Additive-only by default (IF NOT EXISTS semantics)
 *   - Diffable against lastAppliedSchema for evolution detection
 */

export interface IyonaColumnDef {
  /** Column name */
  name: string;
  /** Postgres type: text, int8, uuid, timestamptz, boolean, jsonb, etc. */
  type: string;
  /** Whether this column is the primary key */
  primaryKey?: boolean;
  /** Default expression, e.g. "gen_random_uuid()" or "now()" */
  default?: string;
  /** NOT NULL constraint. Defaults to false (nullable). */
  notNull?: boolean;
  /** Is this column unique? */
  unique?: boolean;
  /** Foreign key reference in format "table_name.column_name" */
  references?: string;
}

export interface IyonaRlsPolicy {
  /** Policy name (unique per table) */
  name: string;
  /** PERMISSIVE or RESTRICTIVE */
  type?: 'permissive' | 'restrictive';
  /** FOR clause: ALL, SELECT, INSERT, UPDATE, DELETE */
  command: 'all' | 'select' | 'insert' | 'update' | 'delete';
  /** USING expression (SQL) */
  using?: string;
  /** WITH CHECK expression (SQL) */
  withCheck?: string;
}

export interface IyonaTableDef {
  /** Table name (public schema assumed) */
  name: string;
  /** Column definitions */
  columns: IyonaColumnDef[];
  /** RLS policies. At least one required per table (enforced by schema service). */
  policies: IyonaRlsPolicy[];
}

export interface IyonaSchemaDeclaration {
  /** Schema version — always 1 for now */
  version: 1;
  /** Tables to create/ensure exist */
  tables: IyonaTableDef[];
  /**
   * Optional raw SQL to run AFTER table creation (e.g. triggers,
   * functions, storage buckets). Use sparingly — prefer declarative.
   */
  sql?: string;
  /**
   * Whether Supabase Auth is needed. When true, the schema service
   * ensures the `auth.users` reference is available and creates
   * standard auth-related policies.
   */
  enableAuth?: boolean;
}

/**
 * Result from applying a schema declaration.
 */
export interface SchemaApplyResult {
  /** Tables that were created or already existed */
  tablesApplied: string[];
  /** Policies that were created */
  policiesApplied: string[];
  /** Errors (table-level) */
  errors: Array<{ table: string; error: string }>;
  /** Whether the overall apply succeeded (no errors) */
  success: boolean;
}
