import { ArgumentsHost, Logger, NotFoundException, NotImplementedException } from '@nestjs/common';
import { ApiExceptionFilter } from './api-exception.filter';

describe('ApiExceptionFilter', () => {
  it('returns a stable scaffold error code', () => {
    const status = jest.fn().mockReturnThis();
    const json = jest.fn();
    const host = {
      switchToHttp: () => ({
        getRequest: () => ({ requestId: 'request-1' }),
        getResponse: () => ({ status, json }),
      }),
    } as unknown as ArgumentsHost;

    new ApiExceptionFilter().catch(new NotImplementedException('Not ported.'), host);

    expect(status).toHaveBeenCalledWith(501);
    expect(json).toHaveBeenCalledWith({
      success: false,
      error: {
        code: 'CLIENTFLOW_NOT_IMPLEMENTED',
        message: 'Not ported.',
        requestId: 'request-1',
      },
    });
  });

  const hostFor = (json: jest.Mock) => ({
    switchToHttp: () => ({
      getRequest: () => ({ requestId: 'request-2', method: 'GET', originalUrl: '/api/v1/billing/dashboard?period=month' }),
      getResponse: () => ({ status: jest.fn().mockReturnThis(), json }),
    }),
  }) as unknown as ArgumentsHost;

  it('logs the real cause of a server error while the client gets the generic message', () => {
    const log = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const json = jest.fn();
    new ApiExceptionFilter().catch(new RangeError('Invalid time zone specified: Eastern'), hostFor(json));

    expect(json.mock.calls[0][0].error.message).toBe('An unexpected error occurred.');
    expect(log).toHaveBeenCalledWith(expect.stringContaining('GET /api/v1/billing/dashboard?period=month requestId=request-2 status=500'));
    expect(log.mock.calls[0][0]).toContain('Invalid time zone specified: Eastern');
    log.mockRestore();
  });

  it('does not log expected client errors', () => {
    const log = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    new ApiExceptionFilter().catch(new NotFoundException('Client not found.'), hostFor(jest.fn()));
    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
  });
});
