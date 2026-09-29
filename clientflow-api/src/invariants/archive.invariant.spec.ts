import { ScaffoldService } from '../common/services/scaffold.service';
import { ClientflowCompatibilityController } from '../modules/compatibility/compatibility.controller';
import { inMemoryDb } from './in-memory-db';

/**
 * INVARIANT 8: an archived client can always be found through the archive and restored, and
 * archive/restore apply to the client's enrollments on the server, not just in one browser.
 */
const ORG = 'org-a';
const archivedAt = new Date('2026-01-01T00:00:00.000Z');

function setup() {
  const rows = {
    cfClient: [
      { id: 'c-active', organizationId: ORG, isArchived: false, archivedAt: null, archiveReason: null, finalStatus: null, businessName: 'Active LLC' },
      { id: 'c-archived', organizationId: ORG, isArchived: true, archivedAt, archiveReason: 'Closed', finalStatus: 'Archived', businessName: 'Archived LLC' },
    ],
    cfProgramEnrollment: [
      { id: 'e-active', organizationId: ORG, clientId: 'c-active', isArchived: false, archivedAt: null },
      { id: 'e-with-client', organizationId: ORG, clientId: 'c-archived', isArchived: true, archivedAt },
      { id: 'e-earlier', organizationId: ORG, clientId: 'c-archived', isArchived: true, archivedAt: new Date('2025-06-01T00:00:00.000Z') },
    ],
  };
  const controller = new ClientflowCompatibilityController(new ScaffoldService(), inMemoryDb(rows) as never);
  jest.spyOn(controller as never, 'requireOrgFromRequest').mockResolvedValue({ orgId: ORG, admin: { id: 'admin-1' } } as never);
  return { rows, controller };
}

describe('INVARIANT: the archive is reachable and archive/restore cascade on the server', () => {
  it('lists archived clients only under the archive, and still opens them', async () => {
    const { controller } = setup();
    expect((await controller.listClients({} as never)).map((c) => c.id)).toEqual(['c-active']);
    expect((await controller.listClients({} as never, 'true')).map((c) => c.id)).toEqual(['c-archived']);
    await expect(controller.getClient({} as never, 'c-archived')).resolves.toEqual(expect.objectContaining({ id: 'c-archived' }));
  });

  it('archiving a client archives its enrollments with the same timestamp', async () => {
    const { rows, controller } = setup();
    await controller.updateClient({} as never, 'c-active', { isArchived: true, archiveReason: 'Done' });
    const client = rows.cfClient.find((c) => c.id === 'c-active');
    expect(client?.archivedAt).toBeInstanceOf(Date);
    expect(rows.cfProgramEnrollment.find((e) => e.id === 'e-active')).toEqual(
      expect.objectContaining({ isArchived: true, archivedAt: client?.archivedAt }),
    );
  });

  it('restoring clears the archive details and brings back only the enrollments archived with it', async () => {
    const { rows, controller } = setup();
    await controller.updateClient({} as never, 'c-archived', { isArchived: false, status: 'Active' });
    expect(rows.cfClient.find((c) => c.id === 'c-archived')).toEqual(
      expect.objectContaining({ isArchived: false, archivedAt: null, archiveReason: null, finalStatus: null }),
    );
    expect(rows.cfProgramEnrollment.find((e) => e.id === 'e-with-client')?.isArchived).toBe(false);
    expect(rows.cfProgramEnrollment.find((e) => e.id === 'e-earlier')?.isArchived).toBe(true);
  });
});
