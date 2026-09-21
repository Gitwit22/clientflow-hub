import { NotImplementedException } from '@nestjs/common';
import { ScaffoldService } from '../../common/services/scaffold.service';
import { ClientflowCompatibilityController, PublicFormCompatibilityController } from './compatibility.controller';
import { COMPATIBILITY_ROUTE_GROUPS, FUTURE_ROUTE_GROUPS } from './route-inventory';

describe('compatibility route scaffold', () => {
  const scaffold = new ScaffoldService();

  it('keeps the current API 2 route groups', () => {
    expect(COMPATIBILITY_ROUTE_GROUPS).toEqual({
      auth: '/api/v1/auth',
      organizations: '/api/v1/organizations',
      clientflowAdmin: '/api/v1/admin/cf',
      publicForms: '/api/v1/public/form',
    });
  });

  it('tracks the requested standalone route groups', () => {
    expect(FUTURE_ROUTE_GROUPS).toContain('public/contracts');
    expect(FUTURE_ROUTE_GROUPS).toContain('webhooks/n8n');
    expect(FUTURE_ROUTE_GROUPS).toContain('audit');
  });

  it('fails unported admin and public operations explicitly', () => {
    expect(() => new ClientflowCompatibilityController(scaffold).listClients())
      .toThrow(NotImplementedException);
    expect(() => new PublicFormCompatibilityController(scaffold).getForm())
      .toThrow(NotImplementedException);
  });
});
