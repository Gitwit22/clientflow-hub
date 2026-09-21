export const COMPATIBILITY_ROUTE_GROUPS = {
  auth: '/api/v1/auth',
  organizations: '/api/v1/organizations',
  clientflowAdmin: '/api/v1/admin/cf',
  publicForms: '/api/v1/public/form',
} as const;

export const FUTURE_ROUTE_GROUPS = [
  'auth', 'users', 'organizations', 'clients', 'programs', 'forms', 'form-assignments',
  'public/forms', 'contracts', 'public/contracts', 'terms', 'monitoring', 'documents',
  'communications', 'reports', 'archive', 'webhooks/n8n', 'email', 'audit',
] as const;
