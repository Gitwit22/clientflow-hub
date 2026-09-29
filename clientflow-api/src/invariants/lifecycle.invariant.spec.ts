import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Environment } from '../config/env';
import type { N8nService } from '../integrations/n8n/n8n.service';
import type { PrismaService } from '../prisma/prisma.service';
import { ContractsService } from '../modules/contracts/contracts.service';
import { hashContractToken } from '../modules/contracts/contract-lifecycle';
import { WorkflowConfigService } from '../modules/programs/workflow-config.service';
import {
  CONTRACT_TRANSITIONS,
  type ContractStatus,
  transitionContract,
} from '../modules/lifecycle/contract-state';
import { applyEnrollmentClosure } from '../modules/lifecycle/enrollment-closure';
import {
  ENROLLMENT_STATUSES,
  ENROLLMENT_TRANSITIONS,
  assertEnrollmentTransition,
  canTransitionEnrollment,
  transitionEnrollment,
} from '../modules/lifecycle/enrollment-state';
import { inMemoryDb } from './in-memory-db';

const ORG = 'org-a';
const ALL_CONTRACT: ContractStatus[] = ['DRAFT', 'SENT', 'OPENED', 'COMPLETED', 'CANCELLED', 'EXPIRED'];

/** INVARIANT 6: a COMPLETED contract can never transition back to SENT or DRAFT. */
describe('INVARIANT: a completed contract is final', () => {
  it('the table has no way out of COMPLETED or CANCELLED', () => {
    expect(CONTRACT_TRANSITIONS.COMPLETED).toEqual([]);
    expect(CONTRACT_TRANSITIONS.CANCELLED).toEqual([]);
  });

  it.each(ALL_CONTRACT)('transitioning a COMPLETED contract to %s fails and changes nothing', async (to) => {
    const rows = { cfContract: [{ id: 'c1', organizationId: ORG, status: 'COMPLETED', secureTokenHash: null }] };
    const db = inMemoryDb(rows);
    await expect(transitionContract(db as never, { organizationId: ORG, contractId: 'c1', to, data: { secureTokenHash: 'x' } }))
      .rejects.toBeInstanceOf(ConflictException);
    expect(rows.cfContract[0]).toEqual({ id: 'c1', organizationId: ORG, status: 'COMPLETED', secureTokenHash: null });
  });

  it('a resend racing a signature cannot revert it (the contract was read as SENT, then signed)', async () => {
    const rows = { cfContract: [{ id: 'c1', organizationId: ORG, status: 'SENT' }] };
    const db = inMemoryDb(rows);
    rows.cfContract[0].status = 'COMPLETED'; // the client signs between the staff read and the resend write
    await expect(transitionContract(db as never, { organizationId: ORG, contractId: 'c1', to: 'SENT' }))
      .rejects.toBeInstanceOf(ConflictException);
    expect(rows.cfContract[0].status).toBe('COMPLETED');
  });
});

/** INVARIANT 7: a declined/withdrawn/completed enrollment can never be onboarded by signing. */
describe('INVARIANT: a closed enrollment can never be onboarded', () => {
  it('no transition leaves completed or declined; withdrawn is only reinstated by staff', () => {
    for (const to of ENROLLMENT_STATUSES) {
      expect(canTransitionEnrollment('completed', to)).toBe(false);
      expect(canTransitionEnrollment('declined', to)).toBe(false);
      expect(canTransitionEnrollment('withdrawn', to)).toBe(false);
    }
    expect(canTransitionEnrollment('withdrawn', 'active', { byStaff: true })).toBe(true);
    expect(canTransitionEnrollment('withdrawn', 'onboarding', { byStaff: true })).toBe(false);
  });

  it('every transition outside the table is rejected', () => {
    for (const from of ENROLLMENT_STATUSES) {
      for (const to of ENROLLMENT_STATUSES) {
        const allowed = ENROLLMENT_TRANSITIONS[from].includes(to);
        const check = () => assertEnrollmentTransition(from, to, { byStaff: true });
        if (allowed) expect(check).not.toThrow();
        else expect(check).toThrow(BadRequestException);
      }
    }
  });

  it('a concurrent change is detected instead of overwritten', async () => {
    const rows = { cfProgramEnrollment: [{ id: 'e1', organizationId: ORG, status: 'active' }], cfEnrollmentStatusHistory: [] };
    const db = inMemoryDb(rows);
    await expect(transitionEnrollment(db as never, {
      organizationId: ORG,
      enrollmentId: 'e1',
      from: 'onboarding', // stale read
      to: 'active',
      history: { changedByUserId: null, changedByDisplayName: 'system' },
    })).rejects.toBeInstanceOf(ConflictException);
    expect(rows.cfEnrollmentStatusHistory).toHaveLength(0);
  });

  it.each(['withdrawn', 'declined', 'completed'])('signing a contract for a %s enrollment is refused and changes nothing', async (status) => {
    const token = 'k'.repeat(43);
    const rows = {
      cfContract: [{
        id: 'c1', organizationId: ORG, clientId: 'client-1', programId: 'p1', enrollmentId: 'e1', status: 'SENT',
        secureTokenHash: hashContractToken(token), secureTokenExpiresAt: new Date(Date.now() + 86_400_000), completedAt: null,
      }],
      cfProgramEnrollment: [{ id: 'e1', organizationId: ORG, clientId: 'client-1', programId: 'p1', status, isArchived: false }],
      cfClient: [{ id: 'client-1', organizationId: ORG, isArchived: false, status: 'CONTRACT_SENT' }],
      cfProgram: [{ id: 'p1', organizationId: ORG, isActive: true, name: 'P' }],
    };
    const db = inMemoryDb(rows) as unknown as PrismaService;
    const service = new ContractsService(
      db,
      { get: () => 'https://clientflow.example.com' } as unknown as ConfigService<Environment, true>,
      { getWelcomeAvailability: () => 'disabled' } as unknown as N8nService,
      new WorkflowConfigService(db),
    );

    await expect(service.completePublicContract(token, { signedName: 'A', signedEmail: 'a@example.com', agreedToTerms: true }, {
      signerIp: null,
      userAgent: null,
    })).rejects.toBeInstanceOf(NotFoundException);
    expect(rows.cfContract[0].status).toBe('SENT');
    expect(rows.cfClient[0].status).toBe('CONTRACT_SENT');
    expect(rows.cfProgramEnrollment[0].status).toBe(status);
  });

  it('closing an enrollment cancels its open contracts and forms and ends its billing', async () => {
    const rows = {
      cfContract: [
        { id: 'c-open', organizationId: ORG, clientId: 'client-1', enrollmentId: 'e1', status: 'SENT' },
        { id: 'c-signed', organizationId: ORG, clientId: 'client-1', enrollmentId: 'e1', status: 'COMPLETED' },
      ],
      cfFormAssignment: [
        { id: 'f-open', organizationId: ORG, enrollmentId: 'e1', submittedAt: null, status: 'sent' },
        { id: 'f-done', organizationId: ORG, enrollmentId: 'e1', submittedAt: new Date(), status: 'submitted' },
      ],
      cfEnrollmentBillingAgreement: [{ id: 'b1', organizationId: ORG, enrollmentId: 'e1', status: 'active' }],
    };
    await applyEnrollmentClosure(inMemoryDb(rows) as never, { id: 'e1', organizationId: ORG, clientId: 'client-1', status: 'withdrawn' });
    expect(rows.cfContract.map((c) => c.status)).toEqual(['CANCELLED', 'COMPLETED']);
    expect(rows.cfFormAssignment.map((f) => f.status)).toEqual(['cancelled', 'submitted']);
    expect(rows.cfEnrollmentBillingAgreement[0].status).toBe('ended');
  });
});
