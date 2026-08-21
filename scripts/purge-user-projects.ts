/**
 * Hard-delete every project owned by one user (by Mongo user id or email).
 * Mirrors `purge-all-projects.ts` but scoped to a single account — useful
 * for resetting a test user without touching anyone else.
 *
 * Does **not** use HTTP and requires **no** login. Reads `MONGO_URL` from `.env`.
 *
 *   npm run projects:purge-user -- --email=test@example.com
 *   npm run projects:purge-user -- --userId=507f1f77bcf86cd799439011
 *   npm run projects:purge-user -- --email=test@example.com --confirm
 *   npm run projects:purge-user -- --email=test@example.com --confirm --no-s3
 *
 * Without `--confirm` this is a dry run (lists ids and counts only).
 *
 * Per project id it removes:
 *   - the `user_projects` row
 *   - related Mongo rows (revisions, deployments, chats, members, jobs, …)
 *   - the `projects/<id>/` prefix in S3 (unless `--no-s3`)
 *
 * Does **not** tear down Vercel previews or Supabase instances (same as
 * purge-all). GitHub repos are left intact.
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
  'workspacecursorjobs',
  'specbuildjobs',
];

const ALL_TARGET_COLLECTIONS = [
  ...USER_PROJECT_COLLECTIONS,
  ...RELATED_BY_PROJECT_ID,
] as const;

interface ParsedArgs {
  userId?: string;
  email?: string;
  confirm: boolean;
  noS3: boolean;
}

function parseArgs(): ParsedArgs {
  const argv = process.argv.slice(2);
  let userId: string | undefined;
  let email: string | undefined;
  let confirm = false;
  let noS3 = false;
  for (const arg of argv) {
    if (arg.startsWith('--userId=')) userId = arg.slice('--userId='.length);
    else if (arg.startsWith('--email=')) email = arg.slice('--email='.length);
    else if (arg === '--confirm') confirm = true;
    else if (arg === '--no-s3') noS3 = true;
  }
  return { userId, email, confirm, noS3 };
}

function mongoOid(id: string): ObjectId {
  try {
    return new ObjectId(id);
  } catch {
    throw new Error(`Invalid ObjectId: ${id}`);
  }
}

async function resolveUserId(
  db: ReturnType<MongoClient['db']>,
  args: ParsedArgs,
): Promise<{ userId: ObjectId; email?: string }> {
  if (args.userId) {
    const oid = mongoOid(args.userId);
    const users = db.collection('users');
    const user = await users.findOne(
      { _id: oid },
      { projection: { email: 1 } },
    );
    if (!user) {
      throw new Error(`No user with _id ${args.userId}`);
    }
    return {
      userId: oid,
      email: typeof user.email === 'string' ? user.email : undefined,
    };
  }

  if (args.email) {
    const normalized = args.email.trim().toLowerCase();
    if (!normalized.length) {
      throw new Error('--email must not be empty');
    }
    const user = await db
      .collection('users')
      .findOne({ email: normalized }, { projection: { _id: 1, email: 1 } });
    if (!user?._id) {
      throw new Error(`No user with email ${normalized}`);
    }
    return {
      userId: user._id as ObjectId,
      email: normalized,
    };
  }

  throw new Error(
    'Pass --userId=<mongoId> or --email=<address>\n' +
      'Example: npm run projects:purge-user -- --email=test@example.com --confirm',
  );
}

async function findOwnedProjectIds(
  db: ReturnType<MongoClient['db']>,
  userId: ObjectId,
): Promise<string[]> {
  const idSet = new Set<string>();

  for (const cname of USER_PROJECT_COLLECTIONS) {
    const collList = await db
      .listCollections({ name: cname })
      .toArray()
      .catch(() => [] as { name: string }[]);
    if (collList.length === 0) continue;

    const cursor = db.collection(cname).find(
      { userId },
      { projection: { _id: 1, name: 1, deletedAt: 1 } },
    );
    for await (const doc of cursor) {
      idSet.add(String(doc._id));
    }
  }

  return [...idSet];
}

async function main(): Promise<void> {
  const args = parseArgs();
  const mongoUrl = process.env.MONGO_URL;
  if (!mongoUrl) {
    throw new Error('MONGO_URL must be set');
  }

  const client = new MongoClient(mongoUrl);
  await client.connect();
  try {
    const db = client.db();
    const { userId, email } = await resolveUserId(db, args);
    const projectIds = await findOwnedProjectIds(db, userId);
    const oids = projectIds.map(mongoOid);

    console.log('[purge-user] Target user:');
    console.log(`  _id:   ${String(userId)}`);
    if (email) console.log(`  email: ${email}`);
    console.log(
      `[purge-user] Found ${projectIds.length} owned project(s) (includes soft-deleted)`,
    );

    if (projectIds.length === 0) {
      console.log('[purge-user] Nothing to do.');
      return;
    }

    if (!args.confirm) {
      console.log(
        '[purge-user] DRY RUN. Re-run with --confirm to actually delete.',
      );
      console.log('[purge-user] Project id(s):');
      console.log(projectIds.join('\n'));
      return;
    }

    console.log('[purge-user] Deleting Mongo rows…');

    for (const cname of ALL_TARGET_COLLECTIONS) {
      const collList = await db
        .listCollections({ name: cname })
        .toArray()
        .catch(() => [] as { name: string }[]);
      if (collList.length === 0) continue;

      const coll = db.collection(cname);
      const filter =
        cname === 'user_projects' || cname === 'userprojects'
          ? { _id: { $in: oids } }
          : { projectId: { $in: oids } };
      const res = await coll.deleteMany(filter);
      if (res.deletedCount > 0) {
        console.log(`  ${cname}: deleted ${res.deletedCount}`);
      }
    }

    if (args.noS3) {
      console.log('[purge-user] --no-s3: skipped S3 cleanup');
    } else {
      const bucket = process.env.AWS_S3_BUCKET;
      if (!bucket) {
        console.warn('[purge-user] AWS_S3_BUCKET not set — skipping S3 cleanup');
      } else {
        console.log('[purge-user] Cleaning S3 prefixes…');
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
      `[purge-user] Done. Purged ${projectIds.length} project(s) for user ${String(userId)}.`,
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
  console.error('[purge-user] FAILED');
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
