import type { ContractsService } from '../contracts/contracts.service';
import { ClientsController } from './clients.controller';
import type { ClientsService } from './clients.service';

describe('ClientsController.approveReview', () => {
  it('derives the staff signer from the authenticated session instead of trusting the request body', async () => {
    const contracts = {
      approveReview: jest.fn().mockResolvedValue({ nextAction: 'CONTRACT_SENT' }),
    };
    const controller = new ClientsController(
      {} as unknown as ClientsService,
      contracts as unknown as ContractsService,
    );
    const request = {
      adminUser: { id: 'admin-1', displayName: 'Jordan Real', role: 'org_admin' },
    } as never;

    await controller.approveReview(request, 'client-1', { staffSignerName: 'Someone Else' });

    expect(contracts.approveReview).toHaveBeenCalledWith('client-1', {
      id: 'admin-1',
      name: 'Jordan Real',
    });
  });

  it('falls back to the request body when no authenticated session is present', async () => {
    const contracts = {
      approveReview: jest.fn().mockResolvedValue({ nextAction: 'CONTRACT_SENT' }),
    };
    const controller = new ClientsController(
      {} as unknown as ClientsService,
      contracts as unknown as ContractsService,
    );
    const request = {} as never;

    await controller.approveReview(request, 'client-1', { staffSignerName: 'Jordan Staff' });

    expect(contracts.approveReview).toHaveBeenCalledWith('client-1', {
      id: null,
      name: 'Jordan Staff',
    });
  });
});
