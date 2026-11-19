import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '../../generated/clientflow';
import { generalIntakeTemplateId } from '../forms/intake-lifecycle';

/**
 * What a program needs before it can take clients, worked out from how the program is set up.
 * Only what that program's workflow uses is required: an agreement only when its journey has a
 * contract stage or it sends one automatically, a welcome email only when it sends one automatically.
 * Programs that don't use contracts can be activated without one.
 */
export type SetupItemKey =
  | 'intake_form'
  | 'enrollment_agreement'
  | 'welcome_email'
  | 'deliverables'
  | 'billing'
  | 'award_agreement';

export interface SetupItem {
  key: SetupItemKey;
  label: string;
  required: boolean;
  done: boolean;
  /** What is missing or why it is (not) needed, for staff. */
  detail: string;
}

export interface ProgramSetup {
  programId: string;
  isActive: boolean;
  /** True when every required item is done. */
  ready: boolean;
  items: SetupItem[];
  missingRequired: SetupItem[];
}

/** Statuses and legacy step names that mean the program's journey includes a contract stage. */
const CONTRACT_STATUSES = ['Terms Proposed', 'Contract Pending'];
const CONTRACT_STEPS = ['terms', 'contract'];
/** Statuses/steps the journey editor recognizes at all (mirrors src/lib/program-journey.ts). */
const KNOWN_STATUSES = [
  'New Intake', 'Needs Review', 'More Information Needed', 'Qualified', 'Approved',
  'Terms Proposed', 'Contract Pending', 'Active', 'Monitoring', 'Final Report Needed', 'Completed',
];
const KNOWN_STEPS = ['intake', 'form', 'review', 'qualified', 'approved', 'terms', 'contract', 'active', 'monitoring', 'final report', 'completed', 'completion'];

const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []);

/**
 * Whether a program's journey includes the contract stage, read the same way the program page's
 * journey editor reads it: a program with no recognizable stages uses the default journey, which
 * includes it.
 */
export function journeyHasContractStage(program: { statusPipeline: unknown; defaultWorkflow: unknown }): boolean {
  const statuses = strings(program.statusPipeline);
  const steps = strings(program.defaultWorkflow).map((step) => step.trim().toLowerCase());
  const recognized = statuses.some((status) => KNOWN_STATUSES.includes(status)) || steps.some((step) => KNOWN_STEPS.includes(step));
  if (!recognized) return true;
  return statuses.some((status) => CONTRACT_STATUSES.includes(status)) || steps.some((step) => CONTRACT_STEPS.includes(step));
}

type Db = Pick<
  Prisma.TransactionClient,
  | 'cfFormTemplate'
  | 'cfProgramWorkflowConfig'
  | 'cfProgramContractTemplate'
  | 'cfProgramContractVersion'
  | 'cfProgramWelcomeEmailVersion'
  | 'cfProgramDeliverableTemplate'
  | 'cfProgramBillingConfig'
>;

interface ProgramForSetup {
  id: string;
  organizationId: string;
  isActive: boolean;
  defaultFormTemplateId: string;
  statusPipeline: unknown;
  defaultWorkflow: unknown;
}

/** Whether a program's intake choice is the organization's general intake (no extra questions). */
export function usesGeneralIntake(organizationId: string, templateId: string | null | undefined): boolean {
  return templateId === GENERAL_INTAKE_CHOICE || templateId === generalIntakeTemplateId(organizationId);
}

/** What staff pick for "General intake only" in the program dialog. */
export const GENERAL_INTAKE_CHOICE = 'general-intake';

/** Forms the public intake shows as a program's own questions (mirrors the public intake's lookup). */
const programSectionWhere = (organizationId: string, programId: string) => ({
  organizationId,
  programId,
  isActive: true,
  OR: [{ scope: 'program_section' }, { scope: 'legacy' }],
});

/**
 * Refuses an intake choice the public intake would ignore: a program's intake is either the general
 * intake alone, or questions that belong to that program. A brand-new program (no id yet) can only
 * start with the general intake; its own questions are added from the program page.
 */
export async function assertIntakeChoice(
  db: Pick<Prisma.TransactionClient, 'cfFormTemplate'>,
  organizationId: string,
  programId: string | null,
  templateId: string,
): Promise<void> {
  if (usesGeneralIntake(organizationId, templateId)) return;
  const owned = programId
    ? await db.cfFormTemplate.findFirst({ where: { id: templateId, ...programSectionWhere(organizationId, programId) }, select: { id: true } })
    : null;
  if (!owned) {
    throw new BadRequestException(
      "Choose General intake, or questions that belong to this program (add them from the program's Program questions tab).",
    );
  }
}

export async function programSetup(db: Db, program: ProgramForSetup): Promise<ProgramSetup> {
  const organizationId = program.organizationId;
  const [ownQuestions, workflow, awardTemplates, deliverableCount, billing] = await Promise.all([
    db.cfFormTemplate.findFirst({ where: programSectionWhere(organizationId, program.id), select: { id: true } }),
    db.cfProgramWorkflowConfig.findFirst({ where: { organizationId, programId: program.id } }),
    db.cfProgramContractTemplate.findMany({
      where: { organizationId, programId: program.id, purpose: 'award', isActive: true },
      select: { id: true, activeVersionId: true },
    }),
    db.cfProgramDeliverableTemplate.count({ where: { organizationId, programId: program.id, active: true } }),
    db.cfProgramBillingConfig.findFirst({ where: { organizationId, programId: program.id } }),
  ]);

  // Intake: the program's own questions (what the public intake shows for it), or the general intake
  // alone. A form that belongs to another program, or to none, is never shown, so it doesn't count.
  const generalOnly = usesGeneralIntake(organizationId, program.defaultFormTemplateId);
  const intakeDone = Boolean(ownQuestions) || generalOnly;

  // Enrollment agreement: the workflow's designated template, with an existing active version.
  const agreementTemplate = workflow?.activeContractTemplateId
    ? await db.cfProgramContractTemplate.findFirst({
        where: { id: workflow.activeContractTemplateId, organizationId, programId: program.id, isActive: true },
        select: { id: true, purpose: true },
      })
    : null;
  const agreementVersion = agreementTemplate && agreementTemplate.purpose !== 'award' && workflow?.activeContractVersionId
    ? await db.cfProgramContractVersion.findFirst({
        where: { id: workflow.activeContractVersionId, organizationId, templateId: agreementTemplate.id },
        select: { id: true },
      })
    : null;
  const automationOn = workflow ? workflow.enabled : true;
  const contractStage = journeyHasContractStage(program);
  const sendsContract = automationOn && Boolean(workflow?.sendContractAfterIntake);
  const agreementRequired = contractStage || sendsContract;

  const sendsWelcome = automationOn && Boolean(workflow?.sendWelcomeAfterContractSigned);
  const welcomeVersion = workflow?.activeWelcomeEmailVersionId
    ? await db.cfProgramWelcomeEmailVersion.findFirst({
        where: { id: workflow.activeWelcomeEmailVersionId, organizationId },
        select: { id: true },
      })
    : null;

  const billingDone = Boolean(billing && billing.active && (!billing.billingRequired || Number(billing.defaultAmount) > 0));
  const awardAgreementDone = awardTemplates.some((template) => Boolean(template.activeVersionId));

  const items: SetupItem[] = [
    {
      key: 'intake_form',
      label: 'Intake form',
      required: true,
      done: intakeDone,
      detail: ownQuestions
        ? "Clients answer this program's questions on the intake form."
        : generalOnly
          ? 'Clients apply through the general intake. Add program questions if you need more.'
          : "Choose General intake, or add this program's questions (Program questions tab).",
    },
    {
      key: 'enrollment_agreement',
      label: 'Enrollment agreement',
      required: agreementRequired,
      done: Boolean(agreementVersion),
      detail: agreementVersion
        ? 'An active enrollment agreement is ready to send.'
        : agreementRequired
          ? `Add the agreement clients sign to join and make a version active (Agreements). Needed because ${
              contractStage ? "the program's journey has a Contract stage" : 'contracts are sent automatically after intake'
            }.`
          : "Not needed: this program's journey has no Contract stage.",
    },
    {
      key: 'welcome_email',
      label: 'Welcome email',
      required: sendsWelcome,
      done: Boolean(welcomeVersion),
      detail: welcomeVersion
        ? 'A welcome email version is active.'
        : sendsWelcome
          ? 'The welcome email is sent automatically after signing: write and activate one (Program workflow).'
          : 'Optional: a general welcome message is used when none is set.',
    },
    {
      key: 'deliverables',
      label: 'Monthly deliverables',
      required: false,
      done: deliverableCount > 0,
      detail: deliverableCount > 0 ? `${deliverableCount} deliverable${deliverableCount === 1 ? '' : 's'} set up.` : 'Optional: what the program provides each month (Deliverables tab).',
    },
    {
      key: 'billing',
      label: 'Billing',
      required: false,
      done: billingDone,
      detail: billingDone ? 'Billing defaults are set.' : 'Optional: the default fee, if members pay (Billing).',
    },
    {
      key: 'award_agreement',
      label: 'Award agreement',
      required: false,
      done: awardAgreementDone,
      detail: awardAgreementDone ? 'An award agreement is ready for funding awards.' : 'Optional: only if awards in this program need a signed agreement (Agreements).',
    },
  ];
  const missingRequired = items.filter((item) => item.required && !item.done);
  return { programId: program.id, isActive: program.isActive, ready: missingRequired.length === 0, items, missingRequired };
}

/** Refuses to activate a program whose required setup is missing, listing what to finish. */
export function assertReadyToActivate(setup: ProgramSetup): void {
  if (setup.ready) return;
  throw new BadRequestException(
    `Finish setting up the program before activating it: ${setup.missingRequired.map((item) => item.label).join(', ')}.`,
  );
}
