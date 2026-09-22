import { ContractsController } from './contracts.controller';
import type { ContractsService } from './contracts.service';
import { SubmitPublicContractDto } from './dto/submit-public-contract.dto';
import { PublicContractsController } from './public-contracts.controller';
import { validate } from 'class-validator';

describe('contract controllers', () => {
  it('delegates generate and send endpoints using the requested client and contract IDs', async () => {
    const service = {
      generateForStaff: jest.fn().mockResolvedValue({ contract: { id: 'contract-1' } }),
      sendForStaff: jest.fn().mockResolvedValue({ contract: { id: 'contract-1', status: 'SENT' } }),
    };
    const controller = new ContractsController(service as unknown as ContractsService);

    await controller.generate('client-1', { staffSignerName: 'Jordan Staff' });
    await controller.send('client-1', { contractId: 'contract-1' });

    expect(service.generateForStaff).toHaveBeenCalledWith('client-1', {
      id: null,
      name: 'Jordan Staff',
    });
    expect(service.sendForStaff).toHaveBeenCalledWith('client-1', 'contract-1');
  });

  it('delegates public contract opening and completion with request metadata', async () => {
    const service = {
      openPublicContract: jest.fn().mockResolvedValue({ contract: { status: 'OPENED' } }),
      completePublicContract: jest.fn().mockResolvedValue({ contract: { status: 'COMPLETED' } }),
    };
    const controller = new PublicContractsController(service as unknown as ContractsService);
    const request = {
      ip: '127.0.0.1',
      socket: {},
      get: jest.fn().mockReturnValue('Contract Browser'),
    };
    const body = {
      signedName: 'Client Owner',
      signedEmail: 'client@example.com',
      agreedToTerms: true as const,
    };

    await controller.getContract('public-token');
    await controller.submitContract('public-token', body, request as never);

    expect(service.openPublicContract).toHaveBeenCalledWith('public-token');
    expect(service.completePublicContract).toHaveBeenCalledWith('public-token', body, {
      signerIp: '127.0.0.1',
      userAgent: 'Contract Browser',
    });
  });

  it('requires a valid signer identity and explicit agreement', async () => {
    const invalid = Object.assign(new SubmitPublicContractDto(), {
      signedName: '',
      signedEmail: 'not-an-email',
      agreedToTerms: false,
    });
    const valid = Object.assign(new SubmitPublicContractDto(), {
      signedName: 'Client Owner',
      signedEmail: 'client@example.com',
      agreedToTerms: true,
    });

    await expect(validate(invalid)).resolves.toHaveLength(3);
    await expect(validate(valid)).resolves.toHaveLength(0);
  });
});
