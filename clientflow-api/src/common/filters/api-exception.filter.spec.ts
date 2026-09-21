import { ArgumentsHost, NotImplementedException } from '@nestjs/common';
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
});
