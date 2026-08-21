import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

/**
 * A single mutual-exclusion lease, keyed by an arbitrary string (in practice a
 * projectId). This replaces the in-process `KeyedMutex` so serialization holds
 * ACROSS Nest workers / replicas, not just within one process.
 *
 * Correctness rests on `expiresAt` compared in the acquire query (NOT on the
 * TTL index, whose 60s sweep granularity is only there to garbage-collect rows
 * an owner failed to release after a crash).
 */
@Schema({ collection: 'distributed_locks' })
export class DistributedLock extends Document {
  /** Lock key — unique so two holders can never both own it. */
  @Prop({ type: String, required: true, unique: true })
  key: string;

  /** Opaque token identifying the current holder (instanceId:uuid). */
  @Prop({ type: String, required: true })
  owner: string;

  /** When the lease lapses. A lock past this is free to steal. */
  @Prop({ type: Date, required: true })
  expiresAt: Date;
}

export const DistributedLockSchema =
  SchemaFactory.createForClass(DistributedLock);

// Backstop cleanup for rows an owner never released (process killed mid-hold).
// The lease is authoritative for correctness; this only reclaims disk.
DistributedLockSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
