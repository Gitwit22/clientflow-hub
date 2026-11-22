import type { PrismaService } from '../../prisma/prisma.service';
import { EnrollmentsService } from './enrollments.service';

describe('EnrollmentsService', () => {
  describe('syncAssignmentToActiveEnrollments', () => {
    it('cascades the new assignee onto non-terminal enrollments only', async () => {
      const prisma = {
        cfProgramEnrollment: { updateMany: jest.fn().mockResolvedValue({ count: 2 }) },
      } as unknown as PrismaService;
      const service = new EnrollmentsService(prisma);

      await service.syncAssignmentToActiveEnrollments('org-1', 'client-1', 'user-2', 'Jordan Staff');

      expect(prisma.cfProgramEnrollment.updateMany).toHaveBeenCalledWith({
        where: {
          organizationId: 'org-1',
          clientId: 'client-1',
          status: { notIn: ['completed', 'declined', 'withdrawn'] },
        },
        data: { assignedUserId: 'user-2', assignedStaff: 'Jordan Staff' },
      });
    });
  });

  describe('ensureEnrollment', () => {
    it('starts a new automated enrollment at the intended interested-stage progress percentage', async () => {
      const prisma = {
        cfProgramEnrollment: { findFirst: jest.fn().mockResolvedValue(null) },
        $transaction: jest.fn(async (callback: (tx: unknown) => unknown) =>
          callback({
            cfClient: { findFirst: jest.fn().mockResolvedValue({ id: 'client-1' }) },
            cfProgram: { findFirst: jest.fn().mockResolvedValue({ id: 'program-1' }) },
            cfProgramEnrollment: { create: jest.fn().mockResolvedValue({ id: 'enroll-1', status: 'interested' }) },
            cfEnrollmentStatusHistory: { create: jest.fn().mockResolvedValue({ id: 'history-1' }) },
            cfActivityLog: { create: jest.fn().mockResolvedValue({ id: 'activity-1' }) },
          }),
        ),
      } as unknown as PrismaService;
      const service = new EnrollmentsService(prisma);
      const createSpy = jest.fn();
      (prisma.$transaction as jest.Mock).mockImplementation(async (callback: (tx: unknown) => unknown) =>
        callback({
          cfClient: { findFirst: jest.fn().mockResolvedValue({ id: 'client-1' }) },
          cfProgram: { findFirst: jest.fn().mockResolvedValue({ id: 'program-1' }) },
          cfProgramEnrollment: { create: createSpy.mockResolvedValue({ id: 'enroll-1', status: 'interested' }) },
          cfEnrollmentStatusHistory: { create: jest.fn().mockResolvedValue({ id: 'history-1' }) },
          cfActivityLog: { create: jest.fn().mockResolvedValue({ id: 'activity-1' }) },
        }),
      );

      await service.ensureEnrollment({
        organizationId: 'org-1',
        clientId: 'client-1',
        programId: 'program-1',
        programName: 'Grant',
        actorDisplayName: 'system',
      });

      expect(createSpy).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ progressPercentage: 10 }),
      }));
    });
  });

  describe('createManualEnrollment', () => {
    function serviceFor(client: Record<string, unknown>) {
      const enrollmentCreate = jest.fn().mockResolvedValue({ id: 'enroll-1', status: 'active' });
      const activityCreate = jest.fn().mockResolvedValue({ id: 'activity-1' });
      const prisma = {
        $transaction: jest.fn(async (callback: (tx: unknown) => unknown) =>
          callback({
            cfClient: { findFirst: jest.fn().mockResolvedValue(client) },
            cfProgram: { findFirst: jest.fn().mockResolvedValue({ id: 'program-1' }) },
            cfProgramEnrollment: { create: enrollmentCreate },
            cfEnrollmentStatusHistory: { create: jest.fn().mockResolvedValue({ id: 'history-1' }) },
            cfActivityLog: { create: activityCreate },
          }),
        ),
      } as unknown as PrismaService;
      return { service: new EnrollmentsService(prisma), enrollmentCreate, activityCreate };
    }
    const input = {
      organizationId: 'org-1', clientId: 'client-1', programId: 'program-1', status: 'active', progressPercentage: 10,
      actorUserId: 'admin-1', actorDisplayName: 'Admin',
    };

    it("marks a test client's enrollment (and its activity) as test, so it stays out of counts", async () => {
      const { service, enrollmentCreate, activityCreate } = serviceFor({ id: 'client-1', isDemo: true });
      await service.createManualEnrollment(input);
      expect(enrollmentCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ isDemo: true }) }));
      expect(activityCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ isDemo: true }) }));
    });

    it("never marks a real client's enrollment as test, whatever the caller passes", async () => {
      const { service, enrollmentCreate } = serviceFor({ id: 'client-1', isDemo: false });
      await service.createManualEnrollment({ ...input, isDemo: true } as typeof input & { isDemo: boolean });
      expect(enrollmentCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ isDemo: false }) }));
    });
  });
});
