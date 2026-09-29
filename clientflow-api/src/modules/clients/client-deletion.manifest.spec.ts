import { Prisma } from '../../generated/clientflow';
import { CLIENT_DELETION_STEPS, NOT_CLIENT_OWNED } from './client-deletion.manifest';

const CLIENT_KEYS = ['clientId', 'enrollmentId', 'formAssignmentId', 'intakeSubmissionId', 'billingAgreementId'];

const delegateName = (model: string) => model.charAt(0).toLowerCase() + model.slice(1);

describe('client deletion manifest', () => {
  const models = Prisma.dmmf.datamodel.models;
  const covered = new Set<string>(CLIENT_DELETION_STEPS.map((step) => step.model));

  it('covers every table that holds a client key (a new table cannot be forgotten)', () => {
    const missing = models
      .filter((model) => model.fields.some((field) => CLIENT_KEYS.includes(field.name)))
      .map((model) => model.name)
      .filter((name) => !covered.has(delegateName(name)) && !(name in NOT_CLIENT_OWNED));
    expect(missing).toEqual([]);
  });

  it('only lists real models, matched on columns they actually have', () => {
    const fieldsByDelegate = new Map(models.map((model) => [delegateName(model.name), new Set(model.fields.map((field) => field.name))]));
    for (const step of CLIENT_DELETION_STEPS) {
      const fields = fieldsByDelegate.get(step.model);
      expect(fields).toBeDefined();
      const column = step.column ?? step.by;
      expect({ model: step.model, column, exists: fields?.has(column) }).toEqual({ model: step.model, column, exists: true });
      expect(fields?.has('organizationId')).toBe(true);
    }
  });

  it('erases money first: payments before agreements, before the enrollments they belong to', () => {
    const order = CLIENT_DELETION_STEPS.map((step) => step.model);
    expect(order.indexOf('cfPaymentRecord')).toBeLessThan(order.indexOf('cfEnrollmentBillingAgreement'));
    expect(order.indexOf('cfEnrollmentBillingAgreement')).toBeLessThan(order.indexOf('cfProgramEnrollment'));
  });
});
