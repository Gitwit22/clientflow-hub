import { DEFAULT_PRODUCTION_APP_URL, environmentSchema, resolveAppUrl } from './env';

describe('environmentSchema', () => {
  it('keeps external side effects disabled by default', () => {
    const environment = environmentSchema.parse({ NODE_ENV: 'test' });
    expect(environment.EMAIL_SEND_ENABLED).toBe('false');
    expect(environment.N8N_ENABLED).toBe('false');
    expect(environment.STORAGE_ENABLED).toBe('false');
    expect(environment.ALLOW_UNAUTHENTICATED_CLIENT_CREATION).toBe('false');
    expect(environment.ALLOW_UNAUTHENTICATED_CONTRACT_MANAGEMENT).toBe('false');
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

  it('rejects unauthenticated contract management in production', () => {
    expect(() => environmentSchema.parse({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://localhost/clientflow',
      JWT_ACCESS_SECRET: 'a'.repeat(32),
      JWT_REFRESH_SECRET: 'b'.repeat(32),
      ALLOW_UNAUTHENTICATED_CONTRACT_MANAGEMENT: 'true',
    })).toThrow('Unauthenticated contract management cannot be enabled in production.');
  });

  it('refuses to start without JWT secrets in every environment except test', () => {
    for (const NODE_ENV of ['development', 'production', undefined]) {
      expect(() => environmentSchema.parse({ NODE_ENV, DATABASE_URL: 'postgresql://localhost/clientflow' }))
        .toThrow('JWT_ACCESS_SECRET is required');
    }
    expect(() => environmentSchema.parse({ NODE_ENV: 'test' })).not.toThrow();
  });

  it('requires different access and refresh secrets', () => {
    expect(() => environmentSchema.parse({
      NODE_ENV: 'development',
      JWT_ACCESS_SECRET: 'a'.repeat(32),
      JWT_REFRESH_SECRET: 'a'.repeat(32),
    })).toThrow('JWT_REFRESH_SECRET must differ from JWT_ACCESS_SECRET.');
  });
});

describe('resolveAppUrl', () => {
  it('uses APP_URL without a trailing slash', () => {
    expect(resolveAppUrl({ NODE_ENV: 'production', APP_URL: 'https://app.example.org/' })).toBe('https://app.example.org');
  });

  it('forces https for production links', () => {
    expect(resolveAppUrl({ NODE_ENV: 'production', APP_URL: 'http://app.example.org' })).toBe('https://app.example.org');
  });

  it('never emails a localhost link from production, set or unset', () => {
    expect(resolveAppUrl({ NODE_ENV: 'production' })).toBe(DEFAULT_PRODUCTION_APP_URL);
    expect(resolveAppUrl({ NODE_ENV: 'production', APP_URL: 'http://localhost:3000' })).toBe(DEFAULT_PRODUCTION_APP_URL);
  });

  it('keeps plain-http local development links', () => {
    expect(resolveAppUrl({ NODE_ENV: 'development' })).toBe('http://localhost:3000');
    expect(resolveAppUrl({ NODE_ENV: 'development', APP_URL: 'http://localhost:5173' })).toBe('http://localhost:5173');
  });
});
