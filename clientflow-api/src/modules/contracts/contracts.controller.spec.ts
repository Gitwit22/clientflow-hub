import { ContractsController } from './contracts.controller';
import type { ContractsService } from './contracts.service';
import { SubmitPublicContractDto } from './dto/submit-public-contract.dto';
import { PublicContractsController } from './public-contracts.controller';
import { validate } from 'class-validator';
import type { ProgramAutomationService } from '../automation/program-automation.service';

describe('contract controllers', () => {
  it('delegates generate and send endpoints using the requested client and contract IDs', async () => {
    const service = {
      generateForStaff: jest.fn().mockResolvedValue({ contract: { id: 'contract-1' } }),
      sendForStaff: jest.fn().mockResolvedValue({ contract: { id: 'contract-1', status: 'SENT' } }),
    };
    const controller = new ContractsController(service as unknown as ContractsService);
    const request = {} as never;

    await controller.generate(request, 'client-1', { staffSignerName: 'Jordan Staff' });
    await controller.send('client-1', { contractId: 'contract-1' });

    expect(service.generateForStaff).toHaveBeenCalledWith('client-1', {
      id: null,
      name: 'Jordan Staff',
    });
    expect(service.sendForStaff).toHaveBeenCalledWith('client-1', 'contract-1');
  });

  it('derives the staff signer from the authenticated session instead of trusting the request body', async () => {
    const service = {
      generateForStaff: jest.fn().mockResolvedValue({ contract: { id: 'contract-1' } }),
    };
    const controller = new ContractsController(service as unknown as ContractsService);
    const request = {
      adminUser: { id: 'admin-1', displayName: 'Jordan Real', role: 'org_admin' },
    } as never;

    await controller.generate(request, 'client-1', { staffSignerName: 'Someone Else' });

    expect(service.generateForStaff).toHaveBeenCalledWith('client-1', {
      id: 'admin-1',
      name: 'Jordan Real',
    });
  });

  it('delegates public contract opening and completion with request metadata', async () => {
    const service = {
      openPublicContract: jest.fn().mockResolvedValue({ contract: { status: 'OPENED' } }),
      completePublicContract: jest.fn().mockResolvedValue({ contract: { status: 'COMPLETED' } }),
    };
    const automation = { runTrigger: jest.fn() } as unknown as ProgramAutomationService;
    const controller = new PublicContractsController(service as unknown as ContractsService, automation);
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

  it('runs program automation when a signed contract reports program context', async () => {
    const service = {
      completePublicContract: jest.fn().mockResolvedValue({
        organizationId: 'org-1',
        programId: 'program-1',
        enrollmentId: 'enroll-1',
        contract: { id: 'contract-1', status: 'COMPLETED' },
        client: { id: 'client-1', status: 'ONBOARDING' },
      }),
    };
    const automation = { runTrigger: jest.fn().mockResolvedValue({}) } as unknown as ProgramAutomationService;
    const controller = new PublicContractsController(service as unknown as ContractsService, automation);

    await controller.submitContract('public-token', {
      signedName: 'Client Owner',
      signedEmail: 'client@example.com',
      agreedToTerms: true,
    }, {
      ip: '127.0.0.1',
      socket: {},
      get: jest.fn().mockReturnValue('Contract Browser'),
    } as never);

    expect(automation.runTrigger).toHaveBeenCalledWith({
      organizationId: 'org-1',
      clientId: 'client-1',
      trigger: 'contract.signed',
      programIds: ['program-1'],
      enrollmentIdsByProgramId: { 'program-1': 'enroll-1' },
      actorDisplayName: 'public contract',
      idempotencySeed: 'public-contract-signed:contract-1',
    });
  });

  it('returns non-fatal automation failure metadata when contract automation throws', async () => {
    const service = {
      completePublicContract: jest.fn().mockResolvedValue({
        organizationId: 'org-1',
        programId: 'program-1',
        enrollmentId: 'enroll-1',
        contract: { id: 'contract-1', status: 'COMPLETED' },
        client: { id: 'client-1', status: 'ONBOARDING' },
      }),
    };
    const automation = {
      runTrigger: jest.fn().mockRejectedValue(new Error('automation unavailable')),
    } as unknown as ProgramAutomationService;
    const controller = new PublicContractsController(service as unknown as ContractsService, automation);

    const result = await controller.submitContract('public-token', {
      signedName: 'Client Owner',
      signedEmail: 'client@example.com',
      agreedToTerms: true,
    }, {
      ip: '127.0.0.1',
      socket: {},
      get: jest.fn().mockReturnValue('Contract Browser'),
    } as never);

    expect(result).toEqual(expect.objectContaining({
      automation: expect.objectContaining({ status: 'failed' }),
    }));
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
