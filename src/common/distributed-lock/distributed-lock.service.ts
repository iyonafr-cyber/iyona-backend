import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { randomUUID } from 'crypto';
import { DistributedLock } from './distributed-lock.entity';

export interface LockOptions {
  /** Lease length; auto-renewed at leaseMs/3 while `fn` runs. */
  leaseMs?: number;
  /** How long to wait to acquire before giving up with 409. */
  waitMs?: number;
}

function isDuplicateKeyError(err: unknown): boolean {
  return (
    !!err &&
    typeof err === 'object' &&
    (err as { code?: number }).code === 11000
  );
}

/**
 * Cross-process mutual exclusion backed by a Mongo lease document. Drop-in
 * replacement for the single-process `KeyedMutex`: two callers (in the same
 * process OR different replicas) that ask for the same key never run their
 * callbacks concurrently.
 *
 * Held only for the duration of `fn`; the lease is renewed on a timer so a
 * long-running critical section (an agent round) keeps the lock, while a
 * crashed holder's lease simply lapses and the next caller steals it.
 */
@Injectable()
export class DistributedLockService {
  private readonly logger = new Logger(DistributedLockService.name);
  private readonly instanceId = randomUUID();

  constructor(
    @InjectModel(DistributedLock.name)
    private readonly lockModel: Model<DistributedLock>,
  ) {}

  async runExclusive<T>(
    key: string,
    fn: () => Promise<T>,
    options?: LockOptions,
  ): Promise<T> {
    const leaseMs = options?.leaseMs ?? 30_000;
    const waitMs = options?.waitMs ?? 600_000;
    const owner = `${this.instanceId}:${randomUUID()}`;

    await this.acquire(key, owner, leaseMs, waitMs);

    const renewEvery = Math.max(2_000, Math.floor(leaseMs / 3));
    const renewTimer = setInterval(() => {
      void this.renew(key, owner, leaseMs);
    }, renewEvery);
    // Don't let the renew timer keep the event loop alive on shutdown.
    if (typeof renewTimer.unref === 'function') renewTimer.unref();

    try {
      return await fn();
    } finally {
      clearInterval(renewTimer);
      await this.release(key, owner);
    }
  }

  private async acquire(
    key: string,
    owner: string,
    leaseMs: number,
    waitMs: number,
  ): Promise<void> {
    const deadline = Date.now() + waitMs;
    for (;;) {
      const now = new Date();
      const expiresAt = new Date(Date.now() + leaseMs);
      try {
        // Steal a free-or-expired lock atomically.
        const taken = await this.lockModel
          .findOneAndUpdate(
            { key, expiresAt: { $lt: now } },
            { $set: { owner, expiresAt } },
            { new: true },
          )
          .exec();
        if (taken) return;

        // No expired row matched — either the lock doesn't exist yet (insert
        // wins) or it's held (insert throws E11000 → wait and retry).
        await this.lockModel.create({ key, owner, expiresAt });
        return;
      } catch (err) {
        if (!isDuplicateKeyError(err)) throw err;
      }

      if (Date.now() >= deadline) {
        throw new ConflictException(
          `Could not acquire lock "${key}" within ${waitMs}ms — another operation is in progress.`,
        );
      }
      // Jittered backoff to avoid a thundering herd on release.
      await this.sleep(150 + Math.floor(Math.random() * 200));
    }
  }

  private async renew(
    key: string,
    owner: string,
    leaseMs: number,
  ): Promise<void> {
    try {
      const res = await this.lockModel
        .updateOne(
          { key, owner },
          { $set: { expiresAt: new Date(Date.now() + leaseMs) } },
        )
        .exec();
      if (res.matchedCount === 0) {
        this.logger.warn(
          `[DistributedLock] Lost lease on "${key}" (owner mismatch) — another holder may have stolen it`,
        );
      }
    } catch (err) {
      this.logger.error(
        `[DistributedLock] renew("${key}") failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async release(key: string, owner: string): Promise<void> {
    try {
      await this.lockModel.deleteOne({ key, owner }).exec();
    } catch (err) {
      this.logger.error(
        `[DistributedLock] release("${key}") failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
