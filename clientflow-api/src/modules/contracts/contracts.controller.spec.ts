import { NotImplementedException } from '@nestjs/common';
import { ContractsController } from './contracts.controller';
import type { ContractsService } from './contracts.service';
import { PublicContractsController } from './public-contracts.controller';

describe('contract controllers', () => {
  it('delegates generate and send endpoints using the requested client and contract IDs', async () => {
    const service = {
      generateForStaff: jest.fn().mockResolvedValue({ contract: { id: 'contract-1' } }),
      sendForStaff: jest.fn().mockResolvedValue({ contract: { id: 'contract-1', status: 'SENT' } }),
    };
    const controller = new ContractsController(service as unknown as ContractsService);

    await controller.generate('client-1');
    await controller.send('client-1', { contractId: 'contract-1' });

    expect(service.generateForStaff).toHaveBeenCalledWith('client-1');
    expect(service.sendForStaff).toHaveBeenCalledWith('client-1', 'contract-1');
  });

  it('keeps public contract signing behind the structured 501 boundary', () => {
    const scaffold = {
      notImplemented: jest.fn(() => {
        throw new NotImplementedException('Public contract signing is not implemented.');
      }),
    };
    const controller = new PublicContractsController(scaffold);

    expect(() => controller.getContract()).toThrow(NotImplementedException);
    expect(scaffold.notImplemented).toHaveBeenCalledWith('Public contract signing');
  });
});
