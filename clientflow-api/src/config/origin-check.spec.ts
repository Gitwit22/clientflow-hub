import type { Request, Response } from 'express';
import { sessionOriginCheck } from './origin-check';

describe('sessionOriginCheck', () => {
  const check = sessionOriginCheck(['https://clientflow-2g9.pages.dev']);
  const run = (method: string, headers: Record<string, string>) => {
    const next = jest.fn();
    const json = jest.fn();
    const response = { status: jest.fn().mockReturnValue({ json }) } as unknown as Response;
    const request = { method, header: (name: string) => headers[name.toLowerCase()] } as unknown as Request;
    check(request, response, next);
    return { passed: next.mock.calls.length === 1, response };
  };
  const cookie = '__Host-clientflow_session=abc; other=1';

  it('lets the app write with its session', () => {
    expect(run('POST', { cookie, origin: 'https://clientflow-2g9.pages.dev' }).passed).toBe(true);
    expect(run('DELETE', { cookie, referer: 'https://clientflow-2g9.pages.dev/clients/1' }).passed).toBe(true);
  });

  it('refuses a signed-in write coming from another site, or with no origin at all', () => {
    const blocked = run('POST', { cookie, origin: 'https://evil.example' });
    expect(blocked.passed).toBe(false);
    expect(blocked.response.status).toHaveBeenCalledWith(403);
    expect(run('PATCH', { cookie: 'clientflow_refresh=x' }).passed).toBe(false);
  });

  it('leaves reads, and requests without the session cookie (public links), alone', () => {
    expect(run('GET', { cookie, origin: 'https://evil.example' }).passed).toBe(true);
    expect(run('POST', { origin: 'https://anywhere.example' }).passed).toBe(true);
    expect(run('POST', { cookie: 'clientflow_sessionish=1' }).passed).toBe(true);
  });
});
