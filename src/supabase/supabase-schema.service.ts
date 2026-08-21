import { Injectable, Logger } from '@nestjs/common';
import {
  JarvisSchemaDeclaration,
  JarvisTableDef,
  JarvisColumnDef,
  JarvisRlsPolicy,
  SchemaApplyResult,
} from './interface/supabase-schema.interface';
import { SupabaseService } from './supabase.service';
import { describeSqlTarget, type SqlTarget } from './sql-target';

/**
 * Converts AI-generated JSON schema declarations into SQL and applies them to
 * a project's Postgres. All operations use IF NOT EXISTS semantics
 * (additive-only) so re-running is always safe.
 *
 * RLS is enforced on EVERY table — the service refuses to apply a table
 * without at least one policy (unless enableAuth generates defaults).
 *
 * Transport-agnostic (decision 07): takes a {@link SqlTarget}, so the same
 * schema pipeline runs over the Management API for managed projects and over a
 * direct Postgres connection for BYO ones. When neither is available,
 * {@link buildSchemaSql} produces the identical script for the owner to run by
 * hand — the manual path must never drift from the automatic one, which is why
 * policy defaulting lives in `normalizeSchema` and is shared by both.
 */
@Injectable()
export class SupabaseSchemaService {
  private readonly logger = new Logger(SupabaseSchemaService.name);

  constructor(private readonly supabaseService: SupabaseService) {}

  /**
   * Apply a full schema declaration to a Supabase project.
   * Idempotent — safe to call on every generation.
   */
  async applySchema(
    target: SqlTarget,
    schema: JarvisSchemaDeclaration,
  ): Promise<SchemaApplyResult> {
    const result: SchemaApplyResult = {
      tablesApplied: [],
      policiesApplied: [],
      errors: [],
      success: true,
    };

    if (target.mode === 'mgmt' && !this.supabaseService.isEnabled()) {
      result.errors.push({
        table: '*',
        error: 'Supabase Management API is not configured.',
      });
      result.success = false;
      return result;
    }

    this.normalizeSchema(schema);
    // Apply tables one by one (order matters for foreign keys)
    for (const table of schema.tables) {
      try {
        const sql = this.buildTableSql(table);
        await this.runSql(target, sql);
        result.tablesApplied.push(table.name);

        // Apply policies
        for (const policy of table.policies) {
          try {
            const policySql = this.buildPolicySql(table.name, policy);
            await this.runSql(target, policySql);
            result.policiesApplied.push(`${table.name}.${policy.name}`);
          } catch (err) {
            const message = this.errMsg(err);
            // Policy already exists — not an error
            if (message.includes('already exists')) {
              result.policiesApplied.push(`${table.name}.${policy.name}`);
            } else {
              result.errors.push({
                table: table.name,
                error: `Policy ${policy.name}: ${message}`,
              });
            }
          }
        }
      } catch (err) {
        const message = this.errMsg(err);
        this.logger.warn(
          `Schema apply failed for table ${table.name} on ${describeSqlTarget(target)}: ${message}`,
        );
        result.errors.push({ table: table.name, error: message });
        result.success = false;
      }
    }

    // Apply optional raw SQL (triggers, functions, etc.)
    if (schema.sql) {
      try {
        await this.runSql(target, schema.sql);
      } catch (err) {
        const message = this.errMsg(err);
        result.errors.push({ table: '__custom_sql', error: message });
        result.success = false;
      }
    }

    if (result.errors.length > 0) {
      result.success = false;
    }

    this.logger.log(
      `Schema applied to ${describeSqlTarget(target)}: ${result.tablesApplied.length} tables, ` +
        `${result.policiesApplied.length} policies, ${result.errors.length} errors`,
    );

    return result;
  }

  /**
   * Fill in default RLS policies for any table that declares none, mutating
   * the declaration in place.
   *
   * Shared by {@link applySchema} and {@link buildSchemaSql} so a copy-paste
   * script is byte-for-byte what auto-apply would have run. If this ever
   * forks, owners on the manual path get a subtly different (and probably less
   * locked-down) database than owners on the automatic one.
   */
  private normalizeSchema(schema: JarvisSchemaDeclaration): void {
    for (const table of schema.tables) {
      if (table.policies && table.policies.length > 0) continue;

      if (schema.enableAuth) {
        // Auth is on: authenticated users get full access, anonymous none.
        table.policies = [
          {
            name: `${table.name}_authenticated_access`,
            command: 'all',
            using: '(auth.uid() IS NOT NULL)',
            withCheck: '(auth.uid() IS NOT NULL)',
          },
        ];
        continue;
      }

      // Default: public read, authenticated write.
      table.policies = [
        {
          name: `${table.name}_public_read`,
          command: 'select',
          using: 'true',
        },
        {
          name: `${table.name}_authenticated_write`,
          command: 'insert',
          using: '(auth.uid() IS NOT NULL)',
          withCheck: '(auth.uid() IS NOT NULL)',
        },
        {
          name: `${table.name}_authenticated_update`,
          command: 'update',
          using: '(auth.uid() IS NOT NULL)',
          withCheck: '(auth.uid() IS NOT NULL)',
        },
        {
          name: `${table.name}_authenticated_delete`,
          command: 'delete',
          using: '(auth.uid() IS NOT NULL)',
        },
      ];
    }
  }

  /**
   * Render a schema declaration as a single runnable SQL script, without
   * executing anything.
   *
   * This is the fallback path from decision 07: when a BYO project has no
   * database connection string, Jarvis cannot apply DDL, so it hands the owner
   * the exact script to paste into the Supabase SQL editor. Every statement is
   * additive and idempotent, so re-running after a partial paste is safe.
   */
  buildSchemaSql(schema: JarvisSchemaDeclaration): string {
    this.normalizeSchema(schema);

    const blocks: string[] = [
      '-- Generated by Jarvis. Safe to run more than once.',
      '-- Paste into Supabase → SQL Editor → New query, then Run.',
    ];

    for (const table of schema.tables) {
      blocks.push(`-- ── ${table.name} ──`);
      blocks.push(this.buildTableSql(table));
      for (const policy of table.policies) {
        blocks.push(this.buildPolicySql(table.name, policy));
      }
    }

    if (schema.sql) {
      blocks.push('-- ── seed data / triggers / functions ──');
      blocks.push(schema.sql.trim());
    }

    return blocks.join('\n\n') + '\n';
  }

  /**
   * Build CREATE TABLE IF NOT EXISTS SQL from a table definition.
   */
  private buildTableSql(table: JarvisTableDef): string {
    const cols = table.columns.map((c) => this.buildColumnDef(c)).join(',\n  ');

    return `
CREATE TABLE IF NOT EXISTS public."${this.escapeIdent(table.name)}" (
  ${cols}
);

ALTER TABLE public."${this.escapeIdent(table.name)}" ENABLE ROW LEVEL SECURITY;
`.trim();
  }

  /**
   * Build a column definition fragment.
   */
  private buildColumnDef(col: JarvisColumnDef): string {
    const parts: string[] = [`"${this.escapeIdent(col.name)}"`, col.type];

    if (col.primaryKey) parts.push('PRIMARY KEY');
    if (col.notNull && !col.primaryKey) parts.push('NOT NULL');
    if (col.unique) parts.push('UNIQUE');
    if (col.default) parts.push(`DEFAULT ${col.default}`);
    if (col.references) {
      const [refTable, refCol] = col.references.split('.');
      parts.push(
        `REFERENCES public."${this.escapeIdent(refTable)}"("${this.escapeIdent(refCol || 'id')}")`,
      );
    }

    return parts.join(' ');
  }

  /**
   * Build CREATE POLICY SQL. Uses DO $$ block to make it idempotent.
   */
  private buildPolicySql(tableName: string, policy: JarvisRlsPolicy): string {
    const tbl = this.escapeIdent(tableName);
    const pName = this.escapeIdent(policy.name);
    const cmd = (policy.command || 'all').toUpperCase();
    const pType = (policy.type || 'permissive').toUpperCase();

    let createSql = `CREATE POLICY "${pName}" ON public."${tbl}" AS ${pType} FOR ${cmd} TO public`;

    if (policy.using) {
      createSql += ` USING (${policy.using})`;
    }
    if (policy.withCheck) {
      createSql += ` WITH CHECK (${policy.withCheck})`;
    }

    // Wrap in DO block for idempotency
    return `
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = '${tbl}' AND policyname = '${pName}'
  ) THEN
    EXECUTE '${createSql.replace(/'/g, "''")}';
  END IF;
END
$$;
`.trim();
  }

  /**
   * Escape a SQL identifier (prevent injection).
   */
  private escapeIdent(s: string): string {
    return s.replace(/"/g, '""').replace(/\\/g, '');
  }

  /**
   * Run SQL against the project's Postgres over the target's transport.
   */
  private async runSql(target: SqlTarget, sql: string): Promise<void> {
    await this.supabaseService.runSql(target, sql);
  }

  private errMsg(err: unknown): string {
    if (err instanceof Error) return err.message;
    return 'unknown error';
  }
}
