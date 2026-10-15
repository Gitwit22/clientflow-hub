import { ArgumentsHost, Logger, NotFoundException, NotImplementedException, ServiceUnavailableException } from '@nestjs/common';
import type { TelemetryReport } from '../../integrations/support-hub/support-hub-telemetry';
import { ApiExceptionFilter, componentForPath } from './api-exception.filter';

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

    expect(json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.objectContaining({ message: 'An unexpected error occurred.' }) }));
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

describe('ApiExceptionFilter → Support Hub telemetry', () => {
  const hostWith = (request: Record<string, unknown>) => ({
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => ({ status: jest.fn().mockReturnThis(), json: jest.fn() }),
    }),
  }) as unknown as ArgumentsHost;

  beforeEach(() => jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined));
  afterEach(() => jest.restoreAllMocks());

  it('reports a server error with the route template and no exception message', () => {
    const reportError = jest.fn<void, [TelemetryReport]>();
    const request = {
      requestId: 'req-9',
      method: 'POST',
      path: '/api/v1/public/forms/abcdefghijklmnopqrstuvwxyz123456/submit',
      originalUrl: '/api/v1/public/forms/abcdefghijklmnopqrstuvwxyz123456/submit',
      route: { path: '/api/v1/public/forms/:token/submit' },
    };
    const leaky = Object.assign(new Error('Unique constraint failed: email=jane@example.com'), {
      name: 'PrismaClientKnownRequestError',
      code: 'P2002',
    });

    new ApiExceptionFilter({ reportError }).catch(leaky, hostWith(request));

    expect(reportError).toHaveBeenCalledTimes(1);
    const report = reportError.mock.calls[0][0];
    expect(report).toEqual({
      type: 'error',
      severity: 'error',
      code: 'DATABASE_P2002',
      message: 'PrismaClientKnownRequestError P2002',
      component: 'public-forms',
      context: { requestId: 'req-9', route: '/api/v1/public/forms/:token/submit', method: 'POST', statusCode: 500 },
    });
    expect(JSON.stringify(report)).not.toContain('jane@example.com');
    expect(JSON.stringify(report)).not.toContain('abcdefghijklmnop');
  });

  it('classifies unhandled errors and HTTP 5xx exceptions by type, and 501 as a warning', () => {
    const reportError = jest.fn<void, [TelemetryReport]>();
    const filter = new ApiExceptionFilter({ reportError });
    filter.catch(new RangeError('Invalid time zone specified: Eastern'), hostWith({ method: 'GET', path: '/api/v1/billing/dashboard' }));
    filter.catch(new ServiceUnavailableException('n8n is not configured.'), hostWith({ method: 'POST', path: '/api/v1/clients/c1/welcome' }));
    filter.catch(new NotImplementedException('Not ported.'), hostWith({ method: 'GET', path: '/api/v1/reports' }));

    expect(reportError.mock.calls.map(([r]) => [r.component, r.code, r.type, r.message])).toEqual([
      ['billing', 'UNHANDLED_RANGE_ERROR', 'error', 'RangeError'],
      ['clients', 'SERVICE_UNAVAILABLE', 'error', 'ServiceUnavailableException (HTTP 503)'],
      ['reports', 'CLIENTFLOW_NOT_IMPLEMENTED', 'warning', 'Endpoint not implemented'],
    ]);
    // Without a matched route template, no route is sent at all.
    expect(reportError.mock.calls[0][0].context?.route).toBeUndefined();
  });

  it('reports an unreachable database as a critical DATABASE_UNAVAILABLE', () => {
    const reportError = jest.fn<void, [TelemetryReport]>();
    const unreachable = Object.assign(new Error("Can't reach database server at db.internal:5432"), { name: 'PrismaClientInitializationError' });
    new ApiExceptionFilter({ reportError }).catch(unreachable, hostWith({ method: 'POST', path: '/api/v1/auth/login', route: { path: '/api/v1/auth/login' } }));
    expect(reportError.mock.calls[0][0]).toMatchObject({ code: 'DATABASE_UNAVAILABLE', severity: 'critical', component: 'auth', message: 'PrismaClientInitializationError' });
  });

  it('does not report client errors', () => {
    const reportError = jest.fn<void, [TelemetryReport]>();
    new ApiExceptionFilter({ reportError }).catch(new NotFoundException('Client not found.'), hostWith({ method: 'GET' }));
    expect(reportError).not.toHaveBeenCalled();
  });

  it('still sends the response when reporting throws', () => {
    const json = jest.fn();
    const host = {
      switchToHttp: () => ({
        getRequest: () => ({ method: 'GET', path: '/api/v1/clients' }),
        getResponse: () => ({ status: jest.fn().mockReturnThis(), json }),
      }),
    } as unknown as ArgumentsHost;
    const reportError = jest.fn<void, [TelemetryReport]>(() => {
      throw new Error('boom');
    });
    new ApiExceptionFilter({ reportError }).catch(new Error('db down'), host);
    expect(json).toHaveBeenCalled();
  });

  it('derives components from static route prefixes only', () => {
    expect(componentForPath('/api/v1/clients/:id/contracts')).toBe('clients');
    expect(componentForPath('/api/v1/public/contracts/:token')).toBe('public-contracts');
    expect(componentForPath('/api/v1/public/:token')).toBe('public');
    expect(componentForPath('/api/v1/')).toBe('api');
  });
});
