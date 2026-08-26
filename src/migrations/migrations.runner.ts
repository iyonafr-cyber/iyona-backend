/**
 * Numbered migrations runner.
 *
 * Each migration is a small async function with a numeric prefix, e.g.
 * `001-backfill-personal-orgs.ts`. We record applied ids in
 * `schema_migrations` so re-runs are idempotent. This is intentionally
 * boring: there's no rollback here; the goal is "we can ship a schema
 * change without manual mongo-shell sessions" not "we can build an ORM".
 *
 * Wire new migrations by:
 *   1. Adding `await this.runMigration('NNN-something', async () => {...})`
 *      to `runAll()` below in the order you want it applied.
 *   2. Make sure the function is idempotent — anyone with an unmigrated
 *      cluster will run them all on next boot; anyone already on HEAD
 *      will skip.
 */
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';

interface MigrationDoc {
  _id: string;
  appliedAt: Date;
}

@Injectable()
export class MigrationsRunner implements OnModuleInit {
  private readonly logger = new Logger(MigrationsRunner.name);
  private readonly collectionName = 'schema_migrations';

  constructor(@InjectConnection() private readonly conn: Connection) {}

  async onModuleInit(): Promise<void> {
    if (process.env.SKIP_MIGRATIONS === '1') {
      this.logger.log('SKIP_MIGRATIONS=1 — skipping migration runner');
      return;
    }
    try {
      await this.runAll();
    } catch (err) {
      // Don't take the app down if a migration fails — log loudly and
      // let the operator decide. Most migrations here are backfills that
      // can be retried safely.
      this.logger.error(
        `migration runner failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  private async runAll(): Promise<void> {
    await this.runMigration('004-customdomain-sparse-unique', async () => {
      // Build a sparse unique index on `customDomain`. We can't blindly
      // call createIndex because legacy data may already contain
      // duplicates (one row per project, but two projects accidentally
      // pointing at the same hostname). Detect those, keep the
      // earliest-attached row (by _id), and unset the field on the
      // others so the index build doesn't fail and we don't lose data.
      const projects = this.conn.collection<{
        _id: import('mongodb').ObjectId;
        customDomain?: string;
      }>('user_projects');

      const dupes = await projects
        .aggregate<{ _id: string; ids: import('mongodb').ObjectId[] }>([
          {
            $match: {
              customDomain: { $exists: true, $nin: [null, ''] },
            },
          },
          { $sort: { _id: 1 } },
          { $group: { _id: '$customDomain', ids: { $push: '$_id' } } },
          { $match: { 'ids.1': { $exists: true } } },
        ])
        .toArray();
      for (const dup of dupes) {
        const losers = dup.ids.slice(1);
        if (losers.length === 0) continue;
        this.logger.warn(
          `customDomain "${dup._id}" attached to ${dup.ids.length} ` +
            `projects; keeping ${String(dup.ids[0])}, unsetting on others ` +
            `to allow unique index build`,
        );
        await projects.updateMany(
          { _id: { $in: losers } },
          {
            $unset: { customDomain: '' },
            $set: { domainVerified: false },
          },
        );
      }

      try {
        await projects.createIndex(
          { customDomain: 1 },
          {
            unique: true,
            sparse: true,
            name: 'customDomain_unique_sparse',
          },
        );
      } catch (err) {
        // If a same-named index already exists with different options,
        // log loud and move on; the operator can drop it manually.
        this.logger.warn(
          `createIndex(customDomain) skipped: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    });

    await this.runMigration('005-chat-orderkey-backfill', async () => {
      // Editable prompts need a sort key that survives an edit. `createdAt`
      // doesn't: a re-run gets a fresh timestamp and the message jumps to
      // the bottom of the transcript. Backfill `orderKey` from the existing
      // createdAt order — that ordering is correct *today*, before any
      // message has ever been edited, so this is the one safe moment to
      // freeze it.
      type ChatDoc = {
        _id: import('mongodb').ObjectId;
        projectId: import('mongodb').ObjectId;
      };
      const chats = this.conn.collection<ChatDoc>('chats');

      // Per-project, not global: orderKey only has to be monotonic within
      // one transcript, and scoping keeps the numbers small and readable.
      const projectIds = await chats.distinct('projectId', {
        orderKey: { $exists: false },
      });

      for (const projectId of projectIds) {
        const cursor = chats
          .find({ projectId }, { projection: { _id: 1 } })
          .sort({ createdAt: 1, _id: 1 });

        let position = 0;
        const ops: import('mongodb').AnyBulkWriteOperation<ChatDoc>[] = [];
        while (await cursor.hasNext()) {
          const doc = await cursor.next();
          if (!doc?._id) continue;
          position += 1000;
          ops.push({
            updateOne: {
              filter: { _id: doc._id },
              update: {
                $set: {
                  orderKey: position,
                  version: 1,
                  active: true,
                },
              },
            },
          });
        }
        if (ops.length > 0) {
          await chats.bulkWrite(ops, { ordered: false });
        }
      }

      // Tie-break note: `_id` is the secondary sort above because Mongo's
      // ObjectId is monotonic per second, so two chats written inside the
      // same millisecond still resolve to insertion order rather than an
      // arbitrary one.
      this.logger.log(
        `backfilled orderKey for ${projectIds.length} project transcript(s)`,
      );
    });

    await this.runMigration('006-drop-codegen-task-routes', async () => {
      // The `codegen` and `codegen_stream` router tasks existed for the era
      // when this server generated application source. Cursor authors all
      // code now, no credit action maps to either task, and the names are
      // gone from RouterTaskName — so any surviving rows are unreachable
      // config that would still show up in the admin routing UI.
      const res = await this.conn
        .collection('ai_task_routes')
        .deleteMany({ task: { $in: ['codegen', 'codegen_stream'] } });
      this.logger.log(
        `dropped ${res.deletedCount} obsolete codegen task-route row(s)`,
      );
    });
  }

  private async runMigration(
    id: string,
    fn: () => Promise<void>,
  ): Promise<void> {
    const coll = this.conn.collection<MigrationDoc>(this.collectionName);
    const existing = await coll.findOne({ _id: id });
    if (existing) {
      this.logger.debug(`migration ${id} already applied, skipping`);
      return;
    }
    const start = Date.now();
    try {
      this.logger.log(`applying migration ${id}…`);
      await fn();
      await coll.insertOne({ _id: id, appliedAt: new Date() });
      this.logger.log(`migration ${id} applied in ${Date.now() - start}ms`);
    } catch (err) {
      this.logger.error(
        `migration ${id} FAILED after ${Date.now() - start}ms: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      throw err;
    }
  }
}
