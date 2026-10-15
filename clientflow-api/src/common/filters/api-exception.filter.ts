import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { supportHubTelemetry, toErrorCode, type TelemetryReport, type TelemetryReporter } from '../../integrations/support-hub/support-hub-telemetry';

const API_PREFIX = /^\/api\/v1\/?/;

/**
 * Functional area of a request, from its first path segments ("clients", "public-forms"). Only
 * static route prefixes are read, never the ids or tokens that follow them.
 */
export function componentForPath(path: string): string {
  const segments = path.split(/[?#]/, 1)[0].replace(API_PREFIX, '').split('/').filter(Boolean);
  const [first, second] = segments;
  if (!first || first.startsWith(':')) return 'api';
  if (first === 'public' && second && !second.startsWith(':')) return `public-${second}`;
  return first;
}

/**
 * Stable incident key for a server error. Exception messages are never sent: Prisma messages, for
 * one, can quote the client data that was being written.
 */
export function telemetryForException(exception: unknown, status: number): Pick<TelemetryReport, 'code' | 'message' | 'type' | 'severity'> {
  if (status === 501) {
    return { type: 'warning', severity: 'warning', code: 'CLIENTFLOW_NOT_IMPLEMENTED', message: 'Endpoint not implemented' };
  }
  if (exception instanceof HttpException) {
    const name = HttpStatus[status] ?? `HTTP_${status}`;
    return { type: 'error', severity: 'error', code: toErrorCode(name), message: `${exception.name} (HTTP ${status})` };
  }
  if (exception instanceof Error) {
    if (exception.name === 'PrismaClientInitializationError') {
      return { type: 'error', severity: 'critical', code: 'DATABASE_UNAVAILABLE', message: exception.name };
    }
    const prismaCode = (exception as { code?: unknown }).code;
    if (exception.name.startsWith('Prisma') && typeof prismaCode === 'string' && /^P\d{4}$/.test(prismaCode)) {
      return { type: 'error', severity: 'error', code: `DATABASE_${prismaCode}`, message: `${exception.name} ${prismaCode}` };
    }
    return { type: 'error', severity: 'error', code: toErrorCode(`UNHANDLED_${exception.name}`), message: exception.name };
  }
  return { type: 'error', severity: 'error', code: 'UNHANDLED_NON_ERROR_THROW', message: typeof exception };
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('ApiExceptionFilter');

  /** Defaults to the process-wide Support Hub reporter (a no-op when it is not configured). */
  constructor(private readonly telemetry?: TelemetryReporter) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request & { requestId?: string }>();
    const response = http.getResponse<Response>();
    const status = exception instanceof HttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;
    const exceptionResponse = exception instanceof HttpException ? exception.getResponse() : null;
    const message = typeof exceptionResponse === 'string'
      ? exceptionResponse
      : exceptionResponse && typeof exceptionResponse === 'object' && 'message' in exceptionResponse
        ? (exceptionResponse as { message: string | string[] }).message
        : 'An unexpected error occurred.';
    const code = exception instanceof HttpException && exception.getStatus() === 501
      ? 'CLIENTFLOW_NOT_IMPLEMENTED'
      : HttpStatus[status] ?? 'INTERNAL_SERVER_ERROR';

    // The client only ever sees a generic message for a server error, so the log is the one place
    // the real cause is recorded (method, path and request id to match it to the user's report).
    if (status >= 500) {
      const detail = exception instanceof Error ? exception.stack ?? exception.message : String(exception);
      this.logger.error(`${request.method} ${request.originalUrl ?? request.url} requestId=${request.requestId ?? '-'} status=${status}: ${detail}`);
      this.report(exception, status, request);
    }

    response.status(status).json({
      success: false,
      error: { code, message, requestId: request.requestId },
    });
  }

  private report(exception: unknown, status: number, request: Request & { requestId?: string }): void {
    try {
      // Express exposes the matched route template ("/api/v1/clients/:id"); a concrete path could
      // carry a public form or contract token, so it is never sent.
      const matched = (request as { route?: { path?: unknown } }).route;
      const routeTemplate = typeof matched?.path === 'string' ? matched.path : undefined;
      const path: string = routeTemplate ?? request.path ?? '';
      (this.telemetry ?? supportHubTelemetry()).reportError({
        ...telemetryForException(exception, status),
        component: componentForPath(path),
        context: {
          requestId: request.requestId,
          route: routeTemplate,
          method: request.method,
          statusCode: status,
        },
      });
    } catch {
      // Reporting is best-effort; the response below must always be sent.
    }
  }
}
