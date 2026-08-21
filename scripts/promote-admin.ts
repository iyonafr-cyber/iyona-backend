/* eslint-disable no-console */
/**
 * One-off CLI to flip a user's role to ADMIN — and optionally create the
 * account if it doesn't exist yet (bootstrapping the first admin).
 *
 * Usage:
 *   npm run promote:admin -- --email=you@example.com
 *   npm run promote:admin -- --email=you@example.com --demote
 *   npm run promote:admin -- --email=you@example.com --password='S3cret!' --create
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import * as bcrypt from 'bcrypt';
import { UserSchema } from '../src/user/entities/user.entity';
import { UserRole } from '../src/user/roles/roles.enum';

interface ParsedArgs {
  email?: string;
  password?: string;
  demote: boolean;
  create: boolean;
}

function parseArgs(): ParsedArgs {
  const args = process.argv.slice(2);
  let email: string | undefined;
  let password: string | undefined;
  let demote = false;
  let create = false;
  for (const arg of args) {
    if (arg.startsWith('--email=')) email = arg.slice('--email='.length);
    else if (arg.startsWith('--password='))
      password = arg.slice('--password='.length);
    else if (arg === '--demote') demote = true;
    else if (arg === '--create') create = true;
  }
  return { email, password, demote, create };
}

async function main() {
  const { email, password, demote, create } = parseArgs();
  if (!email) {
    console.error(
      'Usage: npm run promote:admin -- --email=<user@example.com> [--demote] [--create --password=<pw>]',
    );
    process.exit(1);
  }

  const mongoUrl = process.env.MONGO_URL;
  if (!mongoUrl) {
    console.error('MONGO_URL is not set. Aborting.');
    process.exit(1);
  }

  await mongoose.connect(mongoUrl);
  const UserModel = mongoose.model('User', UserSchema);
  const targetRole = demote ? UserRole.USER : UserRole.ADMIN;
  const normalizedEmail = email.toLowerCase();

  let user = await UserModel.findOne({ email: normalizedEmail });

  if (!user) {
    if (!create) {
      console.error(
        `User "${email}" not found. Re-run with --create --password=<pw> to bootstrap.`,
      );
      await mongoose.disconnect();
      process.exit(2);
    }
    if (!password) {
      console.error('--create requires --password=<plaintext>.');
      await mongoose.disconnect();
      process.exit(1);
    }
    const hashed = await bcrypt.hash(password, 12);
    user = await UserModel.create({
      email: normalizedEmail,
      password: hashed,
      isVerified: true,
      role: targetRole,
    });
    console.log(
      `Created user ${normalizedEmail} (role=${targetRole}, verified=true). id=${String(
        (user as unknown as { _id: unknown })._id,
      )}`,
    );
    await mongoose.disconnect();
    process.exit(0);
  }

  const userDoc = user as unknown as {
    _id: unknown;
    role: UserRole;
    password: string | null;
    save: () => Promise<unknown>;
  };
  const previous = userDoc.role;
  userDoc.role = targetRole;

  if (password) {
    userDoc.password = await bcrypt.hash(password, 12);
    console.log(`(Also reset password for ${normalizedEmail}.)`);
  }

  await userDoc.save();

  console.log(
    `User ${normalizedEmail} role changed: ${previous} -> ${targetRole}. id=${String(
      userDoc._id,
    )}`,
  );

  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error('promote-admin failed:', err);
  process.exit(1);
});
