import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('ApiExceptionFilter');

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
    }

    response.status(status).json({
      success: false,
      error: { code, message, requestId: request.requestId },
    });
  }
}
