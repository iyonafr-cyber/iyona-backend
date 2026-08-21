import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  HttpStatus,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export interface ApiEnvelope<T> {
  statusCode: number;
  message: string;
  data: T;
  [extra: string]: unknown;
}

/**
 * Normalises every controller response into a consistent envelope:
 *
 *   { statusCode, message, data, ...extra }
 *
 * Controllers may return either:
 *   - a raw value                           → wrapped as `data`
 *   - `{ data: value, ...extra }`           → `data` is used, extra keys
 *                                             (pagination meta, etc.) bubble
 *                                             up to the top of the envelope
 *
 * The old behaviour ("if data.data is undefined, return {}") silently dropped
 * plain-object responses like `{ enabled: true }`; this version preserves them.
 */
@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<
  T,
  ApiEnvelope<unknown>
> {
  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<ApiEnvelope<unknown>> {
    return next.handle().pipe(
      map((result) => {
        if (
          result !== null &&
          typeof result === 'object' &&
          !Array.isArray(result) &&
          'data' in (result as Record<string, unknown>)
        ) {
          const { data, ...rest } = result as Record<string, unknown>;
          return {
            statusCode: HttpStatus.OK,
            message: 'Successful',
            data: data ?? null,
            ...rest,
          };
        }

        return {
          statusCode: HttpStatus.OK,
          message: 'Successful',
          data: (result ?? null) as unknown,
        };
      }),
    );
  }
}
