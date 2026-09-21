import { environmentSchema } from './env';

describe('environmentSchema', () => {
  it('keeps external side effects disabled by default', () => {
    const environment = environmentSchema.parse({ NODE_ENV: 'test' });
    expect(environment.EMAIL_SEND_ENABLED).toBe('false');
    expect(environment.N8N_ENABLED).toBe('false');
    expect(environment.STORAGE_ENABLED).toBe('false');
    expect(environment.ALLOW_UNAUTHENTICATED_CLIENT_CREATION).toBe('false');
  });

  it('requires standalone identity and database secrets in production', () => {
    expect(() => environmentSchema.parse({ NODE_ENV: 'production' })).toThrow('DATABASE_URL is required in production.');
  });

  it('requires n8n credentials only when enabled', () => {
    expect(() => environmentSchema.parse({ NODE_ENV: 'test', N8N_ENABLED: 'true' }))
      .toThrow('N8N_EMAIL_WEBHOOK_URL is required when N8N_ENABLED is true.');
  });

  it('rejects unauthenticated client creation in production', () => {
    expect(() => environmentSchema.parse({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://localhost/clientflow',
      JWT_ACCESS_SECRET: 'a'.repeat(32),
      JWT_REFRESH_SECRET: 'b'.repeat(32),
      ALLOW_UNAUTHENTICATED_CLIENT_CREATION: 'true',
    })).toThrow('Unauthenticated client creation cannot be enabled in production.');
  });
});
