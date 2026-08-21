/**
 * One-shot DB cleanup: hard-deletes *every* user project and related Mongo
 * documents, across all users. Intended for UAT/reset (e.g. before promoting
 * an environment) — not for production without a fresh backup.
 *
 * This does **not** use HTTP (`GET/DELETE /projects`) and requires **no
 * login**. It connects with `MONGO_URL` from `.env` (or the shell).
 *
 *   npm run projects:purge-all
 *   npm run projects:purge-all -- --confirm
 *   npm run projects:purge-all -- --confirm --no-s3
 *
 * What it removes (per project id):
 *   - `user_projects` / `userprojects` (all documents)
 *   - `component_schemas`, `project_snapshots` (PatchService)
 *   - `revisions`, `deployments`, `chats`, `project_members`
 *   - `project_errors`, `project_build_checks`
 *   - the `projects/<id>/` prefix in the revisions S3 bucket (unless
 *     `--no-s3` or `AWS_S3_BUCKET` unset)
 *
 * What it does **not** do (same trade-offs as `purge-legacy`):
 *   - No Vercel or Supabase API teardown (orphan previews/instances are
 *     possible; for full cleanup, run a separate ops pass or use app flows)
 *   - Does not delete users, credits, orgs, or audit logs
 */
import 'dotenv/config';
import { MongoClient, ObjectId } from 'mongodb';
import {
  S3Client,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} from '@aws-sdk/client-s3';

const USER_PROJECT_COLLECTIONS = ['user_projects', 'userprojects'] as const;

const RELATED_BY_PROJECT_ID = [
  'component_schemas',
  'componentschemas',
  'project_snapshots',
  'projectsnapshots',
  'revisions',
  'deployments',
  'chats',
  'project_members',
  'projectmembers',
  'project_errors',
  'projecterrors',
  'project_build_checks',
  'projectbuildchecks',
];

const ALL_TARGET_COLLECTIONS = [
  ...USER_PROJECT_COLLECTIONS,
  ...RELATED_BY_PROJECT_ID,
] as const;

function mongoOids(projectIds: string[]): ObjectId[] {
  return projectIds.map((id) => {
    try {
      return new ObjectId(id);
    } catch {
      throw new Error(`Invalid project id: ${id}`);
    }
  });
}

async function main(): Promise<void> {
  const confirm = process.argv.includes('--confirm');
  const noS3 = process.argv.includes('--no-s3');
  const mongoUrl = process.env.MONGO_URL;
  if (!mongoUrl) {
    throw new Error('MONGO_URL must be set');
  }

  const client = new MongoClient(mongoUrl);
  await client.connect();
  try {
    const db = client.db();
    const idSet = new Set<string>();

    for (const cname of USER_PROJECT_COLLECTIONS) {
      const collList = await db
        .listCollections({ name: cname })
        .toArray()
        .catch(() => [] as { name: string }[]);
      if (collList.length === 0) continue;

      const cursor = db.collection(cname).find(
        {},
        { projection: { _id: 1 } },
      );
      for await (const doc of cursor) {
        idSet.add(String(doc._id));
      }
    }

    const projectIds = [...idSet];
    const oids = mongoOids(projectIds);

    console.log(
      `[purge-all] Found ${projectIds.length} project document(s) in user project collection(s)`,
    );
    if (projectIds.length === 0) {
      console.log('[purge-all] Nothing to do. Exiting.');
      return;
    }

    if (!confirm) {
      console.log(
        '[purge-all] DRY RUN. Re-run with --confirm to actually delete.',
      );
      console.log('[purge-all] Affected id(s) (first 40):');
      console.log(projectIds.slice(0, 40).join('\n'));
      if (projectIds.length > 40) {
        console.log(`[purge-all] … and ${projectIds.length - 40} more`);
      }
      return;
    }

    console.log('[purge-all] Deleting Mongo rows…');

    for (const cname of ALL_TARGET_COLLECTIONS) {
      const collList = await db
        .listCollections({ name: cname })
        .toArray()
        .catch(() => [] as { name: string }[]);
      if (collList.length === 0) continue;

      const coll = db.collection(cname);
      let filter: Record<string, unknown>;
      if (cname === 'user_projects' || cname === 'userprojects') {
        filter = { _id: { $in: oids } };
      } else {
        filter = { projectId: { $in: oids } };
      }
      const res = await coll.deleteMany(filter);
      if (res.deletedCount > 0) {
        console.log(`  ${cname}: deleted ${res.deletedCount}`);
      }
    }

    if (noS3) {
      console.log('[purge-all] --no-s3: skipped S3 cleanup');
    } else {
      const bucket = process.env.AWS_S3_BUCKET;
      if (!bucket) {
        console.warn(
          '[purge-all] AWS_S3_BUCKET not set — skipping S3 cleanup',
        );
      } else {
        console.log('[purge-all] Cleaning S3 prefixes…');
        const s3 = new S3Client({
          region: process.env.AWS_REGION || 'us-east-1',
          credentials:
            process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
              ? {
                  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
                  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
                }
              : undefined,
        });
        for (const projectId of projectIds) {
          await deleteS3Prefix(s3, bucket, `projects/${projectId}/`);
        }
      }
    }

    console.log(
      `[purge-all] Done. Purged ${projectIds.length} project(s) and related data.`,
    );
  } finally {
    await client.close();
  }
}

async function deleteS3Prefix(
  s3: S3Client,
  bucket: string,
  prefix: string,
): Promise<void> {
  let token: string | undefined;
  let total = 0;
  do {
    const list = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: token,
      }),
    );
    const keys = (list.Contents ?? [])
      .map((o) => o.Key)
      .filter((k): k is string => Boolean(k));
    if (keys.length > 0) {
      await s3.send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: { Objects: keys.map((k) => ({ Key: k })) },
        }),
      );
      total += keys.length;
    }
    token = list.IsTruncated ? list.NextContinuationToken : undefined;
  } while (token);
  if (total > 0) {
    console.log(`  s3://${bucket}/${prefix}: deleted ${total} object(s)`);
  }
}

main().catch((err) => {
  console.error('[purge-all] FAILED');
  console.error(err);
  process.exit(1);
});
