import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { Types } from 'mongoose';

/**
 * Replace every `Types.ObjectId` (and binary `Buffer`) sitting inside the
 * controller's response tree with its hex-string representation, in place.
 *
 * Why this exists
 * ───────────────
 * NestJS 11's globally-registered `ClassSerializerInterceptor` runs
 * `class-transformer.classToPlain` on every response. Unlike the pre-v11
 * implementation, the v11 path no longer skips plain JS objects, so it
 * happily walks into Mongoose `lean()` documents and shreds their
 * `_id: ObjectId` into `{ buffer: Buffer }` because class-transformer has
 * no knowledge of `ObjectId.toJSON()`.
 *
 * On the wire that becomes:
 *
 *   { "_id": { "buffer": { "type": "Buffer", "data": [..] } }, ... }
 *
 * — which is then template-literal'd in the SPA into `[object Object]`,
 * producing URLs like `/users/[object%20Object]` and 404 cascades.
 *
 * By running this interceptor *after* the `TransformInterceptor` (and
 * therefore *before* `ClassSerializerInterceptor` on the response leg —
 * NestJS reverses interceptor order on egress), we hand class-transformer
 * a tree where every ObjectId has already been collapsed to a string and
 * there is nothing left for it to mangle. Class instances (DTOs created
 * via `plainToInstance`, real Mongoose Documents, etc.) are left
 * untouched so the existing `@Expose`/`@Exclude` paths keep working.
 */

const MAX_DEPTH = 12;

function normalize(value: unknown, depth: number): unknown {
  if (value == null) return value;
  if (depth > MAX_DEPTH) return value;

  // ObjectId → hex string. Covers both the `Types.ObjectId` re-export
  // and any other instance whose `_bsontype` marker is `'ObjectId'`
  // (defensive against duplicate bson copies in node_modules).
  if (value instanceof Types.ObjectId) return value.toHexString();
  if (
    typeof value === 'object' &&
    (value as { _bsontype?: string })._bsontype === 'ObjectId' &&
    typeof (value as { toHexString?: () => string }).toHexString === 'function'
  ) {
    return (value as { toHexString: () => string }).toHexString();
  }

  // Raw Node Buffer → hex string. Without this, class-transformer turns it
  // into `{ type: 'Buffer', data: [..] }` which is never what an HTTP client
  // wants.
  if (Buffer.isBuffer(value)) return value.toString('hex');

  // Dates already have a sane `.toJSON()` and class-transformer leaves them
  // alone; recursing into them just wastes cycles.
  if (value instanceof Date) return value;

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      value[i] = normalize(value[i], depth + 1);
    }
    return value;
  }

  if (typeof value === 'object') {
    const proto = Object.getPrototypeOf(value);
    // Only recurse into plain objects (lean docs, aggregate output, response
    // envelopes). Class instances are skipped on purpose so the existing
    // `plainToInstance(...)` -> CSI -> classToPlain pipeline keeps owning
    // their serialization shape.
    if (proto === Object.prototype || proto === null) {
      const obj = value as Record<string, unknown>;
      for (const key of Object.keys(obj)) {
        const before = obj[key];
        const after = normalize(before, depth + 1);
        if (after !== before) obj[key] = after;
      }
    }
    return value;
  }

  return value;
}

@Injectable()
export class MongoIdNormalizerInterceptor implements NestInterceptor {
  intercept(_ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(map((result) => normalize(result, 0)));
  }
}
