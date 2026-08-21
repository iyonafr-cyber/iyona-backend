/**
 * One-shot script: wipes legacy projects that never got a scaffold
 * materialization (no `templateName` on the project doc). Use when
 * cleaning up pre-scaffold rows so they are not mixed with fully
 * initialized projects.
 *
 *   npm run projects:purge-legacy -- --confirm
 *
 * Without `--confirm` the script does a dry run and exits with a
 * count. Production callers should pipe through the audit log.
 *
 * What it deletes (per project):
 *   - user_projects (the project doc itself)
 *   - component_schemas (PatchService source of truth)
 *   - project_snapshots (PatchService rollback history)
 *   - revisions (S3-pointer rows)
 *   - deployments (Vercel-pointer rows)
 *   - chats (LLM chat history)
 *   - project_members (collab grants)
 *   - project_errors / project_build_checks
 *   - the `projects/<id>/` prefix in the revisions S3 bucket
 *
 * What it does NOT touch:
 *   - Vercel deployments themselves (best-effort cleanup happens via
 *     the existing soft-delete cron — for the cutover we accept some
 *     orphaned previews as cheaper than an in-line teardown)
 *   - Supabase projects (same rationale)
 *   - User accounts, credits, organizations, audit logs
 *   - Projects that have `templateName` set (scaffold-backed creates)
 */
import 'dotenv/config';
import { MongoClient } from 'mongodb';
import {
  S3Client,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} from '@aws-sdk/client-s3';

const COLLECTIONS = [
  'user_projects',
  'userprojects', // mongoose collection-name fallback
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

async function main(): Promise<void> {
  const confirm = process.argv.includes('--confirm');
  const mongoUrl = process.env.MONGO_URL;
  if (!mongoUrl) {
    throw new Error('MONGO_URL must be set');
  }

  const client = new MongoClient(mongoUrl);
  await client.connect();
  try {
    const db = client.db();
    const projectsCollections = ['user_projects', 'userprojects'];
    let totalProjects = 0;
    const projectIds: string[] = [];

    for (const cname of projectsCollections) {
      const exists = await db
        .listCollections({ name: cname })
        .hasNext()
        .catch(() => false);
      if (!exists) continue;

      // Legacy = no templateName field. New projects materialized
      // through the scaffold flow always have it set; legacy ones
      // never will.
      const cursor = db.collection(cname).find(
        {
          $or: [
            { templateName: { $exists: false } },
            { templateName: null },
            { templateName: '' },
          ],
        },
        { projection: { _id: 1 } },
      );
      for await (const doc of cursor) {
        projectIds.push(String(doc._id));
        totalProjects += 1;
      }
    }

    console.log(
      `[purge-legacy] Found ${totalProjects} legacy project(s) without templateName`,
    );
    if (projectIds.length === 0) {
      console.log('[purge-legacy] Nothing to do. Exiting.');
      return;
    }

    if (!confirm) {
      console.log(
        '[purge-legacy] DRY RUN. Re-run with --confirm to actually delete.',
      );
      console.log('[purge-legacy] Affected ids (first 20):');
      console.log(projectIds.slice(0, 20).join('\n'));
      return;
    }

    console.log('[purge-legacy] Deleting Mongo rows…');
    for (const cname of COLLECTIONS) {
      const exists = await db
        .listCollections({ name: cname })
        .hasNext()
        .catch(() => false);
      if (!exists) continue;
      const filter = cname.includes('project') && !cname.includes('user')
        ? {
            projectId: { $in: projectIds.map((id) => mongoOid(id)) },
          }
        : cname.startsWith('user_project') || cname === 'userprojects'
          ? { _id: { $in: projectIds.map((id) => mongoOid(id)) } }
          : { projectId: { $in: projectIds } };
      try {
        const res = await db.collection(cname).deleteMany(filter as any);
        console.log(`  ${cname}: deleted ${res.deletedCount}`);
      } catch (err) {
        console.warn(
          `  ${cname}: delete failed (${(err as Error).message}) — skipping`,
        );
      }
    }

    console.log('[purge-legacy] Cleaning S3 prefixes…');
    const bucket = process.env.AWS_S3_BUCKET;
    if (!bucket) {
      console.warn('[purge-legacy] AWS_S3_BUCKET not set — skipping S3 cleanup');
    } else {
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

    console.log(
      `[purge-legacy] Done. Purged ${projectIds.length} legacy project(s).`,
    );
  } finally {
    await client.close();
  }
}

function mongoOid(id: string): unknown {
  // Avoid taking a hard dep on `bson` here; mongo driver accepts ObjectId
  // strings via the dynamic helper from the existing connection.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { ObjectId } = require('mongodb') as typeof import('mongodb');
  try {
    return new ObjectId(id);
  } catch {
    return id;
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
  console.error('[purge-legacy] FAILED');
  console.error(err);
  process.exit(1);
});
