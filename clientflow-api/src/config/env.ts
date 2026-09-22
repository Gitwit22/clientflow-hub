import { z } from 'zod';

const booleanFlag = z.enum(['true', 'false']).default('false');

export const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().positive().default(4001),
  DATABASE_URL: z.string().min(1).optional(),
  ALLOW_UNAUTHENTICATED_CLIENT_CREATION: booleanFlag,
  ALLOW_UNAUTHENTICATED_CONTRACT_MANAGEMENT: booleanFlag,
  CORS_ORIGIN: z.string().default('http://localhost:3000,http://localhost:5173'),
  APP_URL: z.string().url().default('http://localhost:3000'),
  JWT_ACCESS_SECRET: z.string().min(32).optional(),
  JWT_REFRESH_SECRET: z.string().min(32).optional(),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET_NAME: z.string().optional(),
  R2_PUBLIC_URL: z.string().url().optional(),
  STORAGE_ENABLED: booleanFlag,
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM_NAME: z.string().default('EA Management'),
  EMAIL_FROM_ADDRESS: z.string().email().optional(),
  EMAIL_REPLY_TO: z.string().email().optional(),
  EMAIL_SEND_ENABLED: booleanFlag,
  N8N_ENABLED: booleanFlag,
  N8N_EMAIL_WEBHOOK_URL: z.string().url().optional(),
  CLIENTFLOW_N8N_SECRET: z.string().optional(),
  N8N_EMAIL_BEARER_TOKEN: z.string().optional(),
  N8N_ORGANIZATION_ID: z.string().optional(),
  CLIENTFLOW_N8N_CLIENTFLOW_SECRET: z.string().optional(),
  CLIENTFLOW_N8N_FORM_EMAIL_BEARER_TOKEN: z.string().optional(),
  CLIENTFLOW_N8N_FORM_EMAIL_WEBHOOK_URL: z.string().url().optional(),
  N8N_FORM_EMAIL_ENABLED: z.enum(['true', 'false']).optional(),
  N8N_FORM_EMAIL_WEBHOOK_URL: z.string().url().optional(),
  N8N_CLIENTFLOW_SECRET: z.string().optional(),
  N8N_FORM_EMAIL_BEARER_TOKEN: z.string().optional(),
  N8N_FORM_EMAIL_TIMEOUT_MS: z.coerce.number().int().positive().optional(),
  N8N_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
}).superRefine((environment, context) => {
  if (environment.NODE_ENV === 'production') {
    for (const key of ['DATABASE_URL', 'JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'] as const) {
      if (!environment[key]) {
        context.addIssue({ code: 'custom', path: [key], message: `${key} is required in production.` });
      }
    }
  }
  const n8nEnabled = environment.N8N_ENABLED === 'true' || environment.N8N_FORM_EMAIL_ENABLED === 'true';
  if (n8nEnabled && !(
    environment.N8N_EMAIL_WEBHOOK_URL ?? environment.CLIENTFLOW_N8N_FORM_EMAIL_WEBHOOK_URL ?? environment.N8N_FORM_EMAIL_WEBHOOK_URL
  )) {
    context.addIssue({ code: 'custom', path: ['N8N_EMAIL_WEBHOOK_URL'], message: 'N8N_EMAIL_WEBHOOK_URL is required when N8N_ENABLED is true.' });
  }
  if (n8nEnabled && !(
    environment.CLIENTFLOW_N8N_SECRET ?? environment.CLIENTFLOW_N8N_CLIENTFLOW_SECRET ?? environment.N8N_CLIENTFLOW_SECRET
  )) {
    context.addIssue({ code: 'custom', path: ['CLIENTFLOW_N8N_SECRET'], message: 'CLIENTFLOW_N8N_SECRET is required when N8N_ENABLED is true.' });
  }
  if (environment.NODE_ENV === 'production' && environment.ALLOW_UNAUTHENTICATED_CLIENT_CREATION === 'true') {
    context.addIssue({
      code: 'custom',
      path: ['ALLOW_UNAUTHENTICATED_CLIENT_CREATION'],
      message: 'Unauthenticated client creation cannot be enabled in production.',
    });
  }
  if (environment.NODE_ENV === 'production' && environment.ALLOW_UNAUTHENTICATED_CONTRACT_MANAGEMENT === 'true') {
    context.addIssue({
      code: 'custom',
      path: ['ALLOW_UNAUTHENTICATED_CONTRACT_MANAGEMENT'],
      message: 'Unauthenticated contract management cannot be enabled in production.',
    });
  }
  if (environment.EMAIL_SEND_ENABLED === 'true' && (!environment.RESEND_API_KEY || !environment.EMAIL_FROM_ADDRESS)) {
    context.addIssue({
      code: 'custom',
      path: ['EMAIL_SEND_ENABLED'],
      message: 'RESEND_API_KEY and EMAIL_FROM_ADDRESS are required when email sending is enabled.',
    });
  }
  if (environment.STORAGE_ENABLED === 'true') {
    for (const key of ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME'] as const) {
      if (!environment[key]) {
        context.addIssue({ code: 'custom', path: [key], message: `${key} is required when storage is enabled.` });
      }
    }
  }
});

export type Environment = z.infer<typeof environmentSchema>;
