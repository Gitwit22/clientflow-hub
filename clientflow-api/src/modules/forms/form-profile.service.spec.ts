import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../generated/clientflow';
import type { PrismaService } from '../../prisma/prisma.service';
import { FormProfileService } from './form-profile.service';

const actor = { id: 'admin-1', displayName: 'Jordan Lee' };

/** The single argument passed to the (only) cfClient.update call. */
function updateArg(db: MockDb): { data: Record<string, unknown> } {
  return (db.cfClient.update.mock.calls as [{ data: Record<string, unknown> }][])[0][0];
}

interface MockDb {
  cfClient: { findFirst: jest.Mock; update: jest.Mock };
  cfFormAssignment: { findFirst: jest.Mock };
  cfFormTemplate: { findFirst: jest.Mock };
  cfActivityLog: { create: jest.Mock };
  $transaction: jest.Mock;
}

function build(overrides: {
  client?: Record<string, unknown> | null;
  assignment?: Record<string, unknown> | null;
  template?: Record<string, unknown> | null;
} = {}) {
  const client = overrides.client === null ? null : {
    id: 'client-1',
    organizationId: 'org-1',
    businessName: 'Old Biz',
    primaryContactName: 'Old Name',
    email: 'old@example.com',
    phone: '555',
    website: null,
    socialLinks: [],
    isDemo: false,
    intake: { businessDescription: 'Old description', uploadedFiles: ['a.pdf'], budgetNeed: 'kept' },
    ...overrides.client,
  };
  const assignment = overrides.assignment === null ? null : {
    id: 'assign-1',
    organizationId: 'org-1',
    clientId: 'client-1',
    enrollmentId: 'enroll-1',
    formId: 'form-1',
    responses: {
      email: 'new@example.com',
      description: 'New description',
      links: ['https://a.test'],
      services: ['checkbox', 'array'],
      agree: true,
      budget: 5000,
    },
    ...overrides.assignment,
  };
  const template = overrides.template === null ? null : {
    name: 'Master Intake',
    fields: [
      { id: 'email', label: 'Email', type: 'email' },
      { id: 'description', label: 'Description', type: 'textarea' },
      { id: 'links', label: 'Links', type: 'social_links' },
      { id: 'services', label: 'Services', type: 'checkbox' },
      { id: 'agree', label: 'Agree', type: 'checkbox' },
      { id: 'budget', label: 'Budget', type: 'number' },
    ],
    ...overrides.template,
  };

  const db: MockDb = {
    cfClient: {
      findFirst: jest.fn().mockResolvedValue(client),
      update: jest.fn().mockImplementation(async ({ data }: { data: object }) => ({ ...client, ...data })),
    },
    cfFormAssignment: { findFirst: jest.fn().mockResolvedValue(assignment) },
    cfFormTemplate: { findFirst: jest.fn().mockResolvedValue(template) },
    cfActivityLog: { create: jest.fn().mockResolvedValue({ id: 'activity-1' }) },
    $transaction: jest.fn(),
  };
  db.$transaction.mockImplementation(async (callback: (tx: MockDb) => unknown) => callback(db));
  return { db, service: new FormProfileService(db as unknown as PrismaService) };
}

describe('FormProfileService.preview', () => {
  it('recomputes the differences on the server, ignoring answers that cannot map to text', async () => {
    const { service } = build();
    const preview = await service.preview('org-1', 'client-1', 'assign-1');
    expect(preview.map((change) => [change.key, change.target, change.currentValue, change.newValue])).toEqual([
      ['email', 'top', 'old@example.com', 'new@example.com'],
      ['businessDescription', 'intake', 'Old description', 'New description'],
      ['budgetNeed', 'intake', 'kept', '5000'],
      ['socialLinks', 'socialLinks', '', 'https://a.test'],
    ]);
  });

  it('scopes the assignment lookup to this client and organization', async () => {
    const { service, db } = build();
    await service.preview('org-1', 'client-1', 'assign-1');
    expect(db.cfFormAssignment.findFirst).toHaveBeenCalledWith({
      where: { id: 'assign-1', organizationId: 'org-1', clientId: 'client-1' },
    });
  });

  it("rejects another client's assignment", async () => {
    const { service } = build({ assignment: null });
    await expect(service.preview('org-1', 'client-1', 'someone-elses')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects an assignment with no submitted answers', async () => {
    const { service } = build({ assignment: { responses: {} } });
    await expect(service.preview('org-1', 'client-1', 'assign-1')).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('FormProfileService.apply', () => {
  it('writes only the approved keys and merges into the CURRENT intake', async () => {
    const { service, db } = build();
    const result = await service.apply('org-1', actor, 'client-1', 'assign-1', ['email', 'businessDescription']);

    expect(db.cfClient.update).toHaveBeenCalledTimes(1);
    const data = updateArg(db).data;
    expect(data).toEqual({
      email: 'new@example.com',
      // Current intake keys (uploadedFiles, budgetNeed) survive; only the approved key changes.
      intake: { businessDescription: 'New description', uploadedFiles: ['a.pdf'], budgetNeed: 'kept' },
    });
    expect(result.applied).toEqual(['email', 'businessDescription']);
  });

  it('never writes unapproved keys', async () => {
    const { service, db } = build();
    await service.apply('org-1', actor, 'client-1', 'assign-1', ['email']);
    const data = updateArg(db).data;
    expect(Object.keys(data)).toEqual(['email']);
  });

  it('writes approved social links as a string array', async () => {
    const { service, db } = build();
    await service.apply('org-1', actor, 'client-1', 'assign-1', ['socialLinks']);
    expect(updateArg(db).data).toEqual({ socialLinks: ['https://a.test'] });
  });

  it('re-reads the client inside the transaction, so newer intake values are not overwritten', async () => {
    const { service, db } = build({
      client: { intake: { businessDescription: 'Changed by someone else', newerKey: 'keep me' } },
    });
    await service.apply('org-1', actor, 'client-1', 'assign-1', ['budgetNeed']);
    expect(db.$transaction).toHaveBeenCalled();
    expect(updateArg(db).data.intake).toEqual({
      businessDescription: 'Changed by someone else',
      newerKey: 'keep me',
      budgetNeed: '5000',
    });
  });

  it('logs the action with the staff member and enrollment in the same transaction', async () => {
    const { service, db } = build();
    await service.apply('org-1', actor, 'client-1', 'assign-1', ['email']);
    expect(db.cfActivityLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: 'org-1',
        clientId: 'client-1',
        enrollmentId: 'enroll-1',
        actorUserId: 'admin-1',
        action: 'FORM_RESPONSES_APPLIED',
        user: 'Jordan Lee',
      }),
    });
  });

  it('rejects keys that the submitted answers cannot produce', async () => {
    const { service, db } = build();
    await expect(service.apply('org-1', actor, 'client-1', 'assign-1', ['organizationId'])).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(service.apply('org-1', actor, 'client-1', 'assign-1', ['phone'])).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(db.cfClient.update).not.toHaveBeenCalled();
  });

  it.each([[undefined], [[]], ['email'], [[1]], [['']]])('rejects invalid approved keys: %j', async (fields) => {
    const { service, db } = build();
    await expect(service.apply('org-1', actor, 'client-1', 'assign-1', fields)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(db.cfClient.update).not.toHaveBeenCalled();
  });

  it("rejects another client's assignment and writes nothing", async () => {
    const { service, db } = build({ assignment: null });
    await expect(service.apply('org-1', actor, 'client-1', 'other', ['email'])).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(db.cfClient.update).not.toHaveBeenCalled();
    expect(db.cfActivityLog.create).not.toHaveBeenCalled();
  });

  it('does nothing (and logs nothing) when the approved values already match', async () => {
    const { service, db } = build({ client: { email: 'new@example.com' } });
    const result = await service.apply('org-1', actor, 'client-1', 'assign-1', ['email']);
    expect(result.applied).toEqual([]);
    expect(db.cfClient.update).not.toHaveBeenCalled();
    expect(db.cfActivityLog.create).not.toHaveBeenCalled();
  });

  it('reports a serialization conflict as a retryable 409', async () => {
    const { service, db } = build();
    db.$transaction.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('conflict', { code: 'P2034', clientVersion: 'test' }),
    );
    await expect(service.apply('org-1', actor, 'client-1', 'assign-1', ['email'])).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});

describe('FormProfileService.syncEditedAnswers', () => {
  function withSubmissions(overrides: Parameters<typeof build>[0] = {}) {
    const built = build({ ...overrides, assignment: { submittedAt: new Date(), ...overrides.assignment } });
    const db = built.db as MockDb & { cfIntakeSubmission?: { updateMany: jest.Mock } };
    db.cfIntakeSubmission = { updateMany: jest.fn().mockResolvedValue({ count: 1 }) };
    return { ...built, db: db as MockDb & { cfIntakeSubmission: { updateMany: jest.Mock } } };
  }

  it('updates the profile from the edited answers and the stored intake submission', async () => {
    const { db, service } = withSubmissions();
    const result = await service.syncEditedAnswers('org-1', actor, 'assign-1');

    expect(db.cfIntakeSubmission.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { organizationId: 'org-1', formAssignmentId: 'assign-1' },
    }));
    expect(result.applied).toEqual(expect.arrayContaining(['Business description', 'Social media links']));
    expect(updateArg(db).data).toMatchObject({
      socialLinks: ['https://a.test'],
      intake: { businessDescription: 'New description', budgetNeed: '5000', uploadedFiles: ['a.pdf'] },
    });
    expect(updateArg(db).data).not.toHaveProperty('email');
    expect(db.cfActivityLog.create).toHaveBeenCalledTimes(1);
  });

  it('does nothing for a form that was never submitted', async () => {
    const { db, service } = withSubmissions({ assignment: { submittedAt: null } });
    expect(await service.syncEditedAnswers('org-1', actor, 'assign-1')).toEqual({ applied: [] });
    expect(db.cfClient.update).not.toHaveBeenCalled();
  });
});
