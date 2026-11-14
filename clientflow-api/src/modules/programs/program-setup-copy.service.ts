import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { CfProgramAction, Prisma } from '../../generated/clientflow';
import { PrismaService } from '../../prisma/prisma.service';
import { GENERAL_INTAKE_CHOICE } from './program-setup';
import { WorkflowConfigService } from './workflow-config.service';

/**
 * Copies one program's setup into another program, so a second program can start from a working
 * one (IDI) instead of being rebuilt by hand. Staff choose the parts. Only setup is copied: never
 * clients, enrollments, sent agreements, emails, awards or documents.
 *
 * Rules that keep it safe:
 * - The target must be inactive: a live program is never changed by a copy.
 * - Content (questions, welcome email) is only added where the target has none; agreements,
 *   deliverables and custom emails are added alongside what is there; settings (journey, billing,
 *   automation switches) are replaced.
 * - Everything happens in one transaction, with the target row locked, and is recorded with the
 *   request's idempotency key: a repeated request returns the first copy instead of copying twice.
 */
export const COPY_PARTS = [
  'journey',
  'intakeQuestions',
  'agreements',
  'welcomeEmail',
  'deliverables',
  'billing',
  'automation',
] as const;
export type CopyPart = (typeof COPY_PARTS)[number];

export const COPY_PART_LABELS: Record<CopyPart, string> = {
  journey: 'Journey & settings',
  intakeQuestions: 'Intake questions',
  agreements: 'Agreements',
  welcomeEmail: 'Welcome email',
  deliverables: 'Deliverables',
  billing: 'Billing defaults',
  automation: 'Automatic emails',
};

export type CopyOutcome = 'copy' | 'replace' | 'skip' | 'nothing';

export interface CopyPartResult {
  part: CopyPart;
  label: string;
  outcome: CopyOutcome;
  /** What happens (preview) or happened (apply), in staff wording. */
  detail: string;
}

export interface CopyActor {
  actorUserId: string | null;
  actorDisplayName: string;
  actorEmail: string;
}

export interface CopyRequest {
  sourceProgramId: string;
  parts: CopyPart[];
  idempotencyKey: string;
}

export interface NewProgramInput {
  name: string;
  description: string;
  defaultMonitoringFrequency?: string;
  defaultContractTemplateId?: string;
  /** The journey a blank program would get; replaced when "Journey & settings" is copied. */
  statusPipeline?: string[];
  defaultWorkflow?: string[];
}

type Tx = Prisma.TransactionClient;

interface ProgramRow {
  id: string;
  organizationId: string;
  name: string;
  isActive: boolean;
  defaultFormTemplateId: string;
}

const TX_OPTIONS = { timeout: 30_000, maxWait: 10_000 };

/** Parses the parts staff sent; refuses unknown ones and an empty choice. */
export function parseCopyParts(value: unknown): CopyPart[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new BadRequestException('Choose at least one part of the setup to copy.');
  }
  const parts = [...new Set(value.map(String))];
  const unknown = parts.filter((part) => !(COPY_PARTS as readonly string[]).includes(part));
  if (unknown.length) throw new BadRequestException(`Unknown setup parts: ${unknown.join(', ')}.`);
  return COPY_PARTS.filter((part) => parts.includes(part));
}

/** Forms the public intake shows as a program's own questions (mirrors program-setup.ts). */
const ownQuestionsWhere = (organizationId: string, programId: string) => ({
  organizationId,
  programId,
  isActive: true,
  OR: [{ scope: 'program_section' }, { scope: 'legacy' }],
});

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

@Injectable()
export class ProgramSetupCopyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workflowConfig: WorkflowConfigService,
  ) {}

  /** What a copy would do, part by part. Changes nothing. */
  async preview(organizationId: string, targetProgramId: string | null, sourceProgramId: string, parts: CopyPart[]) {
    const source = await this.findProgram(this.prisma, organizationId, sourceProgramId, 'source');
    const target = targetProgramId ? await this.findProgram(this.prisma, organizationId, targetProgramId, 'target') : null;
    if (target) this.assertCopyable(source, target);
    const results: CopyPartResult[] = [];
    for (const part of parts) results.push(await this.runPart(this.prisma, part, source, target, null, true));
    return { sourceProgramId: source.id, targetProgramId: target?.id ?? null, parts: results };
  }

  /** Copies the chosen parts into an existing, inactive program. */
  async copyInto(organizationId: string, targetProgramId: string, request: CopyRequest, actor: CopyActor) {
    const replay = await this.replay(organizationId, request.idempotencyKey);
    if (replay) return replay;
    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "CfProgram" WHERE "id" = ${targetProgramId} AND "organizationId" = ${organizationId} FOR UPDATE`;
        const target = await this.findProgram(tx, organizationId, targetProgramId, 'target');
        const source = await this.findProgram(tx, organizationId, request.sourceProgramId, 'source');
        this.assertCopyable(source, target);
        return this.copy(tx, source, target, request, actor);
      }, TX_OPTIONS);
    } catch (error) {
      return this.replayAfterDuplicate(error, organizationId, request.idempotencyKey);
    }
  }

  /** Creates a new program (always inactive) and copies the chosen parts into it, in one transaction. */
  async createFromCopy(organizationId: string, input: NewProgramInput, request: CopyRequest, actor: CopyActor) {
    const name = input.name.trim();
    if (!name) throw new BadRequestException('Program name is required.');
    const replay = await this.replay(organizationId, request.idempotencyKey);
    if (replay) return replay;
    try {
      return await this.prisma.$transaction(async (tx) => {
        const source = await this.findProgram(tx, organizationId, request.sourceProgramId, 'source');
        const created = await tx.cfProgram.create({
          data: {
            organizationId,
            name,
            description: input.description.trim(),
            isActive: false,
            defaultFormTemplateId: GENERAL_INTAKE_CHOICE,
            defaultMonitoringFrequency: input.defaultMonitoringFrequency || 'monthly',
            defaultContractTemplateId: input.defaultContractTemplateId || 'unknown',
            defaultWorkflow: input.defaultWorkflow ?? [],
            requiredDocuments: [],
            statusPipeline: input.statusPipeline ?? [],
          },
        });
        await this.workflowConfig.getOrCreateIn(tx, organizationId, created.id, created.name);
        return this.copy(tx, source, created, request, actor);
      }, TX_OPTIONS);
    } catch (error) {
      return this.replayAfterDuplicate(error, organizationId, request.idempotencyKey);
    }
  }

  private async copy(tx: Tx, source: ProgramRow, target: ProgramRow, request: CopyRequest, actor: CopyActor) {
    const results: CopyPartResult[] = [];
    for (const part of request.parts) results.push(await this.runPart(tx, part, source, target, actor, false));
    await tx.cfProgramSetupCopy.create({
      data: {
        organizationId: target.organizationId,
        targetProgramId: target.id,
        sourceProgramId: source.id,
        parts: request.parts,
        summary: results as unknown as Prisma.InputJsonValue,
        idempotencyKey: request.idempotencyKey,
        createdByUserId: actor.actorUserId,
        createdByDisplayName: actor.actorDisplayName,
      },
    });
    return { programId: target.id, sourceProgramId: source.id, parts: results, replayed: false };
  }

  private async replay(organizationId: string, idempotencyKey: string) {
    const existing = await this.prisma.cfProgramSetupCopy.findFirst({ where: { organizationId, idempotencyKey } });
    if (!existing) return null;
    return {
      programId: existing.targetProgramId,
      sourceProgramId: existing.sourceProgramId,
      parts: existing.summary as unknown as CopyPartResult[],
      replayed: true,
    };
  }

  /** Two identical requests at once: the second one's insert of the same key fails; return the first. */
  private async replayAfterDuplicate(error: unknown, organizationId: string, idempotencyKey: string) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const replay = await this.replay(organizationId, idempotencyKey);
      if (replay) return replay;
    }
    throw error;
  }

  private async findProgram(db: Pick<Tx, 'cfProgram'>, organizationId: string, programId: string, role: 'source' | 'target'): Promise<ProgramRow> {
    const program = await db.cfProgram.findFirst({
      where: { id: programId, organizationId },
      select: { id: true, organizationId: true, name: true, isActive: true, defaultFormTemplateId: true },
    });
    if (!program) throw new NotFoundException(role === 'source' ? 'Program to copy from not found.' : 'Program not found.');
    return program;
  }

  private assertCopyable(source: ProgramRow, target: ProgramRow) {
    if (source.id === target.id) throw new BadRequestException('Choose a different program to copy from.');
    if (target.isActive) {
      throw new ConflictException('Setup can only be copied into an inactive program. Deactivate it first, or create a new program from the copy.');
    }
  }

  private runPart(db: Tx, part: CopyPart, source: ProgramRow, target: ProgramRow | null, actor: CopyActor | null, dryRun: boolean): Promise<CopyPartResult> {
    const result = (outcome: CopyOutcome, detail: string): CopyPartResult => ({ part, label: COPY_PART_LABELS[part], outcome, detail });
    const args = { db, source, target, actor, dryRun, result };
    switch (part) {
      case 'journey': return this.copyJourney(args);
      case 'intakeQuestions': return this.copyIntakeQuestions(args);
      case 'agreements': return this.copyAgreements(args);
      case 'welcomeEmail': return this.copyWelcomeEmail(args);
      case 'deliverables': return this.copyDeliverables(args);
      case 'billing': return this.copyBilling(args);
      case 'automation': return this.copyAutomation(args);
    }
  }

  private async copyJourney({ db, source, target, dryRun, result }: PartArgs) {
    const full = await db.cfProgram.findFirstOrThrow({
      where: { id: source.id, organizationId: source.organizationId },
      select: { statusPipeline: true, defaultWorkflow: true, requiredDocuments: true, defaultMonitoringFrequency: true },
    });
    const documents = Array.isArray(full.requiredDocuments) ? full.requiredDocuments.length : 0;
    if (!dryRun && target) {
      await db.cfProgram.update({
        where: { id: target.id, organizationId: target.organizationId },
        data: {
          statusPipeline: full.statusPipeline as Prisma.InputJsonValue,
          defaultWorkflow: full.defaultWorkflow as Prisma.InputJsonValue,
          requiredDocuments: full.requiredDocuments as Prisma.InputJsonValue,
          defaultMonitoringFrequency: full.defaultMonitoringFrequency,
        },
      });
    }
    return result('replace', `Client journey, ${plural(documents, 'required document')} and ${full.defaultMonitoringFrequency.toLowerCase()} monitoring.`);
  }

  private async copyIntakeQuestions({ db, source, target, dryRun, result }: PartArgs) {
    const sections = await db.cfFormTemplate.findMany({
      where: ownQuestionsWhere(source.organizationId, source.id),
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }, { id: 'asc' }],
    });
    // The same form the public intake shows for the source program.
    const form = sections.find((candidate) => candidate.id === source.defaultFormTemplateId)
      ?? sections.find((candidate) => candidate.scope === 'program_section')
      ?? sections[0];
    if (!form) return result('nothing', `${source.name} uses the general intake only; there are no questions to copy.`);
    if (target) {
      const owned = await db.cfFormTemplate.findFirst({ where: ownQuestionsWhere(target.organizationId, target.id), select: { id: true } });
      if (owned) return result('skip', 'This program already has its own intake questions; they are kept.');
    }
    const fieldCount = Array.isArray(form.fields) ? form.fields.length : 0;
    if (!dryRun && target) {
      const copy = await db.cfFormTemplate.create({
        data: {
          organizationId: target.organizationId,
          programId: target.id,
          scope: 'program_section',
          version: 1,
          sortOrder: form.sortOrder,
          name: form.name,
          description: form.description,
          fields: form.fields as Prisma.InputJsonValue,
          emailTemplate: form.emailTemplate,
          internalNotes: form.internalNotes,
          dueInDays: form.dueInDays,
          isActive: true,
        },
      });
      await db.cfProgram.update({
        where: { id: target.id, organizationId: target.organizationId },
        data: { defaultFormTemplateId: copy.id },
      });
    }
    return result('copy', `"${form.name}" (${plural(fieldCount, 'question')}), used as this program's intake questions.`);
  }

  private async copyAgreements({ db, source, target, actor, dryRun, result }: PartArgs) {
    const [templates, sourceWorkflow] = await Promise.all([
      db.cfProgramContractTemplate.findMany({
        where: { organizationId: source.organizationId, programId: source.id, isActive: true },
        orderBy: { createdAt: 'asc' },
      }),
      db.cfProgramWorkflowConfig.findFirst({ where: { organizationId: source.organizationId, programId: source.id } }),
    ]);
    // Each template's version in use: the designated enrollment agreement's, otherwise its own.
    const versionIdOf = (template: (typeof templates)[number]) =>
      template.id === sourceWorkflow?.activeContractTemplateId && sourceWorkflow.activeContractVersionId
        ? sourceWorkflow.activeContractVersionId
        : template.activeVersionId;
    const usable = templates.filter((template) => versionIdOf(template));
    if (!usable.length) return result('nothing', `${source.name} has no agreement ready to copy.`);

    const [existing, targetWorkflow] = target
      ? await Promise.all([
          db.cfProgramContractTemplate.findMany({ where: { organizationId: target.organizationId, programId: target.id }, select: { name: true } }),
          db.cfProgramWorkflowConfig.findFirst({ where: { organizationId: target.organizationId, programId: target.id } }),
        ])
      : [[], null];
    const takenNames = new Set(existing.map((template) => template.name));
    const toCopy = usable.filter((template) => !takenNames.has(template.name));
    const skippedNames = usable.filter((template) => takenNames.has(template.name)).map((template) => template.name);
    if (!toCopy.length) return result('skip', `This program already has agreements named ${skippedNames.map((name) => `"${name}"`).join(', ')}; they are kept.`);

    let designated = Boolean(targetWorkflow?.activeContractTemplateId);
    let designatedName: string | null = null;
    for (const template of toCopy) {
      const isEnrollment = template.purpose !== 'award';
      const becomesEnrollmentAgreement = isEnrollment && !designated;
      if (becomesEnrollmentAgreement) {
        designated = true;
        designatedName = template.name;
      }
      if (dryRun || !target || !actor) continue;
      const version = await db.cfProgramContractVersion.findFirst({
        where: { id: versionIdOf(template)!, organizationId: source.organizationId, templateId: template.id },
      });
      if (!version) continue;
      const created = await db.cfProgramContractTemplate.create({
        data: {
          organizationId: target.organizationId,
          programId: target.id,
          name: template.name,
          signatureRequired: template.signatureRequired,
          isActive: true,
          purpose: template.purpose,
        },
      });
      const firstVersion = await db.cfProgramContractVersion.create({
        data: {
          organizationId: target.organizationId,
          templateId: created.id,
          version: 1,
          title: version.title,
          content: version.content,
          fileUrl: version.fileUrl,
          fileName: version.fileName,
          storedFileId: version.storedFileId,
          signableFields: version.signableFields as Prisma.InputJsonValue,
          createdBy: actor.actorEmail,
        },
      });
      await db.cfProgramContractTemplate.update({ where: { id: created.id }, data: { activeVersionId: firstVersion.id } });
      if (becomesEnrollmentAgreement) {
        const workflow = await this.workflowConfig.getOrCreateIn(db, target.organizationId, target.id, target.name);
        await db.cfProgramWorkflowConfig.update({
          where: { id: workflow.id },
          data: { activeContractTemplateId: created.id, activeContractVersionId: firstVersion.id },
        });
      }
    }
    const names = toCopy.map((template) => `"${template.name}"`).join(', ');
    const notes = [
      designatedName ? `"${designatedName}" becomes the enrollment agreement.` : '',
      skippedNames.length ? `Kept the existing ${skippedNames.map((name) => `"${name}"`).join(', ')}.` : '',
    ].filter(Boolean).join(' ');
    return result('copy', `${plural(toCopy.length, 'agreement')}: ${names}. ${notes}`.trim());
  }

  private async copyWelcomeEmail({ db, source, target, actor, dryRun, result }: PartArgs) {
    const sourceWorkflow = await db.cfProgramWorkflowConfig.findFirst({ where: { organizationId: source.organizationId, programId: source.id } });
    const version = sourceWorkflow?.activeWelcomeEmailVersionId
      ? await db.cfProgramWelcomeEmailVersion.findFirst({
          where: { id: sourceWorkflow.activeWelcomeEmailVersionId, organizationId: source.organizationId },
        })
      : null;
    if (!version) return result('nothing', `${source.name} has no active welcome email to copy.`);
    const sourceTemplate = await db.cfProgramWelcomeEmailTemplate.findFirst({
      where: { id: version.templateId, organizationId: source.organizationId, programId: source.id },
    });
    if (!sourceTemplate) return result('nothing', `${source.name} has no active welcome email to copy.`);
    if (target) {
      const targetWorkflow = await db.cfProgramWorkflowConfig.findFirst({ where: { organizationId: target.organizationId, programId: target.id } });
      if (targetWorkflow?.activeWelcomeEmailVersionId) return result('skip', 'This program already has an active welcome email; it is kept.');
    }
    const withGuide = version.guideStoredFileId ? ', with its guide attachment' : '';
    if (!dryRun && target && actor) {
      const taken = await db.cfProgramWelcomeEmailTemplate.findFirst({
        where: { organizationId: target.organizationId, programId: target.id, name: sourceTemplate.name },
        select: { id: true },
      });
      const template = await db.cfProgramWelcomeEmailTemplate.create({
        data: {
          organizationId: target.organizationId,
          programId: target.id,
          name: taken ? `${sourceTemplate.name} (copied from ${source.name})` : sourceTemplate.name,
          isActive: true,
        },
      });
      const firstVersion = await db.cfProgramWelcomeEmailVersion.create({
        data: {
          organizationId: target.organizationId,
          templateId: template.id,
          version: 1,
          subject: version.subject,
          body: version.body,
          // The same stored guide file, by reference: it is never changed in place.
          guideStoredFileId: version.guideStoredFileId,
          createdBy: actor.actorEmail,
          allowedVariables: version.allowedVariables as Prisma.InputJsonValue,
        },
      });
      const workflow = await this.workflowConfig.getOrCreateIn(db, target.organizationId, target.id, target.name);
      await db.cfProgramWorkflowConfig.update({
        where: { id: workflow.id },
        data: { activeWelcomeEmailTemplateId: template.id, activeWelcomeEmailVersionId: firstVersion.id },
      });
    }
    return result('copy', `"${version.subject}"${withGuide}, used as this program's welcome email.`);
  }

  private async copyDeliverables({ db, source, target, dryRun, result }: PartArgs) {
    const templates = await db.cfProgramDeliverableTemplate.findMany({
      where: { organizationId: source.organizationId, programId: source.id, active: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    if (!templates.length) return result('nothing', `${source.name} has no deliverables to copy.`);
    const existing = target
      ? await db.cfProgramDeliverableTemplate.findMany({
          where: { organizationId: target.organizationId, programId: target.id, active: true },
          select: { title: true },
        })
      : [];
    const taken = new Set(existing.map((template) => template.title.trim().toLowerCase()));
    const toCopy = templates.filter((template) => !taken.has(template.title.trim().toLowerCase()));
    if (!toCopy.length) return result('skip', 'This program already has every one of these deliverables; they are kept.');
    if (!dryRun && target) {
      for (const template of toCopy) {
        await db.cfProgramDeliverableTemplate.create({
          data: {
            organizationId: target.organizationId,
            programId: target.id,
            title: template.title,
            description: template.description,
            cadence: template.cadence,
            active: true,
            sortOrder: template.sortOrder,
            programWideDate: template.programWideDate,
          },
        });
      }
    }
    const kept = templates.length - toCopy.length;
    const wideDates = toCopy.some((template) => template.programWideDate)
      ? ' Program-wide dates are not copied: set this program\'s own dates on its Deliverables tab.'
      : '';
    return result('copy', `${plural(toCopy.length, 'deliverable')}${kept ? ` (${kept} already there, kept)` : ''}.${wideDates}`);
  }

  private async copyBilling({ db, source, target, dryRun, result }: PartArgs) {
    const config = await db.cfProgramBillingConfig.findFirst({ where: { organizationId: source.organizationId, programId: source.id } });
    if (!config) return result('nothing', `${source.name} has no billing defaults to copy.`);
    const data = {
      defaultAmount: config.defaultAmount,
      frequency: config.frequency,
      customIntervalDays: config.customIntervalDays,
      billingRequired: config.billingRequired,
      defaultDueDay: config.defaultDueDay,
      allowCustomClientPricing: config.allowCustomClientPricing,
      active: config.active,
    };
    if (!dryRun && target) {
      const existing = await db.cfProgramBillingConfig.findFirst({ where: { organizationId: target.organizationId, programId: target.id }, select: { id: true } });
      if (existing) await db.cfProgramBillingConfig.update({ where: { id: existing.id }, data });
      else await db.cfProgramBillingConfig.create({ data: { organizationId: target.organizationId, programId: target.id, ...data } });
    }
    const amount = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(config.defaultAmount));
    const state = !config.active ? 'billing off' : config.billingRequired ? `${amount} ${config.frequency}` : `${amount} ${config.frequency}, optional`;
    return result('replace', `Billing defaults: ${state}.`);
  }

  private async copyAutomation({ db, source, target, dryRun, result }: PartArgs) {
    const [sourceWorkflow, rules] = await Promise.all([
      db.cfProgramWorkflowConfig.findFirst({ where: { organizationId: source.organizationId, programId: source.id } }),
      // Only custom emails: other automation actions point at the source program's own forms or
      // documents, which a copy can't carry over.
      db.cfProgramAutomationRule.findMany({
        where: { organizationId: source.organizationId, programId: source.id, action: CfProgramAction.send_email },
        orderBy: [{ trigger: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
      }),
    ]);
    const switches = {
      enabled: sourceWorkflow?.enabled ?? true,
      sendContractAfterIntake: sourceWorkflow?.sendContractAfterIntake ?? false,
      sendWelcomeAfterContractSigned: sourceWorkflow?.sendWelcomeAfterContractSigned ?? false,
    };
    if (!dryRun && target) {
      const workflow = await this.workflowConfig.getOrCreateIn(db, target.organizationId, target.id, target.name);
      await db.cfProgramWorkflowConfig.update({ where: { id: workflow.id }, data: switches });
      for (const rule of rules) {
        await db.cfProgramAutomationRule.create({
          data: {
            organizationId: target.organizationId,
            programId: target.id,
            trigger: rule.trigger,
            conditions: rule.conditions as Prisma.InputJsonValue,
            action: rule.action,
            actionConfig: rule.actionConfig as Prisma.InputJsonValue,
            enabled: rule.enabled,
            sortOrder: rule.sortOrder,
          },
        });
      }
    }
    const on = (value: boolean) => (value ? 'on' : 'off');
    return result(
      'replace',
      `Automation ${on(switches.enabled)}; agreement link after intake ${on(switches.sendContractAfterIntake)}; welcome after signing ${on(switches.sendWelcomeAfterContractSigned)}; ${plural(rules.length, 'custom email')}.`,
    );
  }
}

interface PartArgs {
  db: Tx;
  source: ProgramRow;
  target: ProgramRow | null;
  actor: CopyActor | null;
  dryRun: boolean;
  result: (outcome: CopyOutcome, detail: string) => CopyPartResult;
}
