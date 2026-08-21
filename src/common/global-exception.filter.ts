import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

/**
 * PR-2.D — single place every uncaught error funnels through.
 *
 * Goals:
 *   1. Every error response carries the same `x-request-id` we put on
 *      success responses, so users can paste the id into a support
 *      ticket and we can correlate it with our pino logs.
 *   2. Production responses NEVER include stack traces or raw error
 *      messages from non-HttpException throws — those routinely leak
 *      file paths, library internals, or upstream provider responses.
 *      In dev/test we keep the original message to make debugging fast.
 *   3. Every 5xx is logged with full context (path, method, request id,
 *      and — when available — the user id) so we don't need to scrape
 *      pino-http's request log to find the failing call.
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('GlobalException');
  private readonly isProd = process.env.NODE_ENV === 'production';

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    const requestId =
      (req.headers['x-request-id'] as string | undefined) ||
      (typeof res.getHeader === 'function'
        ? (res.getHeader('x-request-id') as string | undefined)
        : undefined);

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = this.coerceHttpExceptionPayload(exception, requestId);
      if (status >= 500) {
        this.logServerError(req, status, exception, requestId);
      }
      res.status(status).json(payload);
      return;
    }

    this.logServerError(
      req,
      HttpStatus.INTERNAL_SERVER_ERROR,
      exception,
      requestId,
    );

    const message = this.isProd
      ? 'Internal server error'
      : exception instanceof Error
        ? exception.message
        : safeStringify(exception);

    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: 500,
      message,
      ...(requestId ? { requestId } : {}),
    });
  }

  private coerceHttpExceptionPayload(
    exception: HttpException,
    requestId: string | undefined,
  ): Record<string, unknown> {
    const raw = exception.getResponse();
    const base =
      raw && typeof raw === 'object'
        ? (raw as Record<string, unknown>)
        : { message: safeStringify(raw) };
    return requestId ? { ...base, requestId } : base;
  }

  private logServerError(
    req: Request,
    status: number,
    exception: unknown,
    requestId: string | undefined,
  ): void {
    const userId = (req as Request & { user?: { userId?: string } }).user
      ?.userId;
    const stack =
      exception instanceof Error ? exception.stack : safeStringify(exception);
    this.logger.error(
      `${status} ${req.method} ${req.originalUrl} ` +
        `requestId=${requestId ?? '-'} userId=${userId ?? '-'}`,
      stack,
    );
  }
}

function safeStringify(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean')
    return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return '[unserialisable]';
  }
}
