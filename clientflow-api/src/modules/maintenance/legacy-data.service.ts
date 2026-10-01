import { Injectable } from '@nestjs/common';
import { requireManager, type RoleActor } from '../../common/authorization/role-policy';
import type { TenantDb } from '../../common/tenancy/org-scoped.repository';
import { PrismaService } from '../../prisma/prisma.service';
import { deleteClientOwnedRows } from '../clients/client-deletion.service';
import { CLIENT_DELETION_STEPS } from '../clients/client-deletion.manifest';
import { CONTRACT_STATUS } from '../contracts/contract-lifecycle';
import { LEGACY_CONTRACT_WHERE } from '../contracts/legacy-contract';
import { normalizeFormFields } from '../forms/form-field-mapping';
import { CurrentProfile, mapAnswers, profileUpdateFromAnswers } from '../forms/form-profile-mapper';

/** Audit event written when the cleanup is applied (counts only, no client details). */
export const LEGACY_DATA_CLEANUP = 'LEGACY_DATA_CLEANUP';

/** Enrollment statuses that still need a signed contract before the client can start. */
const NEEDS_CONTRACT_STATUSES = ['interested', 'pending_review', 'approved', 'onboarding', 'active', 'on_hold'];

export interface LegacyContractItem {
  contractId: string;
  clientId: string;
  businessName: string | null;
  programName: string | null;
  status: string;
  createdAt: Date;
}

export interface LegacyDataReport {
  applied: boolean;
  contracts: {
    /** Never sent: removed. */
    remove: LegacyContractItem[];
    /** Placeholder drafts that were emailed for signature: the link is cancelled. */
    cancel: LegacyContractItem[];
    /** Signed (or marked signed by staff): kept as the client's record. */
    keep: LegacyContractItem[];
  };
  /** Rows (forms already sent, terms, reports…) attached to the enrollment they belong to. */
  linked: Record<'contracts' | 'formAssignments' | 'terms' | 'finalReports' | 'documentAssignments' | 'communications', number>;
  /** After cleanup, these open enrollments have no real contract yet: staff send one from the program. */
  clientsNeedingContract: Array<{
    clientId: string;
    businessName: string;
    enrollmentId: string;
    programName: string | null;
    enrollmentStatus: string;
  }>;
  /** Clients whose blank profile fields are filled from the forms they already submitted. */
  profilesFilled: Array<{ clientId: string; businessName: string; fields: string[] }>;
  /** Rows whose client no longer exists (left by deletes from before permanent delete). */
  orphans: { clientIds: number; rows: Record<string, number> };
}

type Row = Record<string, unknown>;
type Delegate = {
  findMany(args: Row): Promise<Row[]>;
  updateMany(args: Row): Promise<{ count: number }>;
};

/**
 * Brings existing clients in line with the current workflow: old placeholder contracts from before
 * program contract templates are removed (or their signing link cancelled if one went out),
 * records created before enrollments existed (forms already sent, terms, final reports, document
 * requests, their emails) are attached to the client's enrollment for that program, and rows left
 * behind by clients that no longer exist are cleared. `preview` changes nothing; `apply` does the
 * same work in one transaction. Both are idempotent: a second run finds nothing to do.
 */
@Injectable()
export class LegacyDataService {
  constructor(private readonly prisma: PrismaService) {}

  async preview(organizationId: string, actor: RoleActor): Promise<LegacyDataReport> {
    requireManager(actor);
    return this.run(this.prisma, organizationId, false);
  }

  async apply(organizationId: string, actor: RoleActor & { id: string }): Promise<LegacyDataReport> {
    requireManager(actor);
    return this.prisma.$transaction(async (transaction) => {
      const report = await this.run(transaction, organizationId, true);
      await transaction.auditLog.create({
        data: {
          organizationId,
          actorAdminId: actor.id,
          action: 'updated',
          targetType: LEGACY_DATA_CLEANUP,
          targetId: organizationId,
          metadata: {
            contractsRemoved: report.contracts.remove.length,
            contractsCancelled: report.contracts.cancel.length,
            contractsKept: report.contracts.keep.length,
            linked: report.linked,
            profilesFilled: report.profilesFilled.length,
            orphanClientIds: report.orphans.clientIds,
            orphanRows: report.orphans.rows,
          },
        },
      });
      return report;
    }, { maxWait: 10_000, timeout: 120_000 });
  }

  private async run(db: TenantDb, organizationId: string, apply: boolean): Promise<LegacyDataReport> {
    const scope = { organizationId };

    // 1. Rows of clients that no longer exist. Cleared first so nothing below links to them.
    const orphans = await this.orphans(db, organizationId, apply);

    // 2. Old placeholder contracts.
    const legacy = await db.cfContract.findMany({
      where: { ...scope, ...LEGACY_CONTRACT_WHERE },
      orderBy: { createdAt: 'asc' },
    });
    const [clients, programs] = await Promise.all([
      db.cfClient.findMany({ where: { ...scope, id: { in: [...new Set(legacy.map((c) => c.clientId))] } }, select: { id: true, businessName: true } }),
      db.cfProgram.findMany({ where: scope, select: { id: true, name: true } }),
    ]);
    const clientName = new Map(clients.map((client) => [client.id, client.businessName]));
    const programName = new Map(programs.map((program) => [program.id, program.name]));
    const item = (contract: (typeof legacy)[number]): LegacyContractItem => ({
      contractId: contract.id,
      clientId: contract.clientId,
      businessName: clientName.get(contract.clientId) ?? null,
      programName: programName.get(contract.programId) ?? null,
      status: contract.status,
      createdAt: contract.createdAt,
    });
    const remove: LegacyContractItem[] = [];
    const cancel: LegacyContractItem[] = [];
    const keep: LegacyContractItem[] = [];
    for (const contract of legacy) {
      if (contract.completedAt || contract.executedStoredFileId || /sign|complet|execut/i.test(contract.status)) {
        keep.push(item(contract));
      } else if (contract.secureTokenHash || contract.sentAt) {
        // Out for signature through the real link: only a still-open one needs cancelling.
        if (!['CANCELLED', 'EXPIRED'].includes(contract.status)) cancel.push(item(contract));
      } else {
        remove.push(item(contract));
      }
    }
    if (apply && remove.length) {
      const ids = remove.map((entry) => entry.contractId);
      await db.cfCommunication.updateMany({ where: { ...scope, contractId: { in: ids } }, data: { contractId: null } });
      await db.cfMonitoringTask.deleteMany({ where: { ...scope, contractId: { in: ids } } });
      await db.cfContract.deleteMany({ where: { ...scope, id: { in: ids }, ...LEGACY_CONTRACT_WHERE, completedAt: null } });
    }
    if (apply && cancel.length) {
      await db.cfContract.updateMany({
        where: { ...scope, id: { in: cancel.map((entry) => entry.contractId) }, completedAt: null },
        data: { status: CONTRACT_STATUS.cancelled, secureTokenHash: null, secureTokenExpiresAt: null },
      });
    }

    // 3. Records from before enrollments existed, attached to the (client, program) enrollment.
    const linked = await this.linkToEnrollments(db, organizationId, apply);

    // 4. Clients whose old draft was their only contract: they need a real one from the program.
    const affectedClientIds = [...new Set([...remove, ...cancel].map((entry) => entry.clientId))];
    const clientsNeedingContract: LegacyDataReport['clientsNeedingContract'] = [];
    if (affectedClientIds.length) {
      const [enrollments, realContracts] = await Promise.all([
        db.cfProgramEnrollment.findMany({
          where: { ...scope, clientId: { in: affectedClientIds }, isArchived: false, status: { in: NEEDS_CONTRACT_STATUSES as never } },
          select: { id: true, clientId: true, programId: true, status: true },
        }),
        db.cfContract.findMany({
          where: {
            ...scope,
            clientId: { in: affectedClientIds },
            status: { in: [CONTRACT_STATUS.draft, CONTRACT_STATUS.sent, CONTRACT_STATUS.opened, CONTRACT_STATUS.completed] },
            NOT: LEGACY_CONTRACT_WHERE,
          },
          select: { clientId: true, programId: true },
        }),
      ]);
      const covered = new Set(realContracts.map((contract) => `${contract.clientId}:${contract.programId}`));
      const signedLegacy = new Set(keep.map((entry) => entry.clientId));
      for (const enrollment of enrollments) {
        if (covered.has(`${enrollment.clientId}:${enrollment.programId}`) || signedLegacy.has(enrollment.clientId)) continue;
        clientsNeedingContract.push({
          clientId: enrollment.clientId,
          businessName: clientName.get(enrollment.clientId) ?? '',
          enrollmentId: enrollment.id,
          programName: programName.get(enrollment.programId) ?? null,
          enrollmentStatus: enrollment.status,
        });
      }
    }

    // 5. Profiles of clients who submitted their intake before answers were written to the profile.
    const profilesFilled = await this.fillProfilesFromAnswers(db, organizationId, apply);

    return { applied: apply, contracts: { remove, cancel, keep }, linked, clientsNeedingContract, profilesFilled, orphans };
  }

  /**
   * Fills each client's BLANK profile fields from the forms they submitted, newest answers first.
   * Nothing already on the profile is overwritten (staff may have edited it) and the email is
   * never changed, so running this again finds nothing to do.
   */
  private async fillProfilesFromAnswers(db: TenantDb, organizationId: string, apply: boolean) {
    const scope = { organizationId };
    const submitted = await db.cfFormAssignment.findMany({
      where: { ...scope, submittedAt: { not: null } },
      orderBy: { submittedAt: 'desc' },
      select: { clientId: true, formId: true, responses: true },
    });
    if (!submitted.length) return [];
    const [clients, templates] = await Promise.all([
      db.cfClient.findMany({ where: { ...scope, id: { in: [...new Set(submitted.map((row) => row.clientId))] } } }),
      db.cfFormTemplate.findMany({
        where: { ...scope, id: { in: [...new Set(submitted.map((row) => row.formId))] } },
        select: { id: true, fields: true },
      }),
    ]);
    const fieldsByTemplate = new Map(templates.map((template) => [template.id, normalizeFormFields(template.fields)]));

    const filled: LegacyDataReport['profilesFilled'] = [];
    for (const client of clients) {
      let profile = client as CurrentProfile;
      const data: Record<string, unknown> = {};
      const labels: string[] = [];
      for (const assignment of submitted.filter((row) => row.clientId === client.id)) {
        const fields = fieldsByTemplate.get(assignment.formId);
        const responses = assignment.responses;
        if (!fields || typeof responses !== 'object' || responses === null || Array.isArray(responses)) continue;
        const update = profileUpdateFromAnswers(mapAnswers(fields, responses as Record<string, unknown>), profile, 'fill-blanks');
        if (!update.labels.length) continue;
        Object.assign(data, update.data);
        labels.push(...update.labels.filter((label) => !labels.includes(label)));
        profile = { ...profile, ...update.data } as CurrentProfile;
      }
      if (!labels.length) continue;
      filled.push({ clientId: client.id, businessName: client.businessName, fields: labels });
      if (apply) {
        await db.cfClient.update({ where: { id: client.id }, data });
        await db.cfActivityLog.create({
          data: {
            organizationId,
            clientId: client.id,
            action: 'PROFILE_FILLED_FROM_FORMS',
            description: `Filled ${labels.join(', ')} from the client's submitted forms.`,
            user: 'Legacy data cleanup',
            isDemo: client.isDemo,
          },
        });
      }
    }
    return filled;
  }

  /**
   * Attaches rows that have no enrollment (or point at one that is gone) to the client's enrollment
   * in the same program. A client has at most one enrollment per program, so the match is exact;
   * rows with no enrollment for their program are left as they are.
   */
  private async linkToEnrollments(db: TenantDb, organizationId: string, apply: boolean) {
    const scope = { organizationId };
    const enrollments = await db.cfProgramEnrollment.findMany({ where: scope, select: { id: true, clientId: true, programId: true } });
    const enrollmentIds = new Set(enrollments.map((enrollment) => enrollment.id));
    const byClientProgram = new Map(enrollments.map((enrollment) => [`${enrollment.clientId}:${enrollment.programId}`, enrollment.id]));
    const noEnrollment = [{ enrollmentId: null }, { enrollmentId: { notIn: [...enrollmentIds] } }];
    const unlinked = { ...scope, OR: noEnrollment };

    const link = async (delegate: Delegate, programOf: (row: Row) => string | null | undefined) => {
      const rows = await delegate.findMany({ where: unlinked });
      let count = 0;
      for (const row of rows) {
        const programId = programOf(row);
        const enrollmentId = programId ? byClientProgram.get(`${String(row.clientId)}:${programId}`) : undefined;
        if (!enrollmentId || enrollmentId === row.enrollmentId) continue;
        count += 1;
        if (apply) await delegate.updateMany({ where: { ...scope, id: row.id }, data: { enrollmentId } });
      }
      return count;
    };
    const asDelegate = (delegate: unknown) => delegate as Delegate;

    // Program forms belong to the enrollment for the form's program; general forms stay client-wide.
    const templates = await db.cfFormTemplate.findMany({ where: scope, select: { id: true, programId: true } });
    const templateProgram = new Map(templates.map((template) => [template.id, template.programId]));

    const linked = {
      contracts: await link(asDelegate(db.cfContract), (row) => row.programId as string),
      formAssignments: await link(asDelegate(db.cfFormAssignment), (row) => templateProgram.get(String(row.formId))),
      terms: await link(asDelegate(db.cfTerms), (row) => row.programId as string),
      finalReports: await link(asDelegate(db.cfFinalReport), (row) => row.programId as string),
      documentAssignments: await link(asDelegate(db.cfDocumentAssignment), (row) => row.programId as string),
      communications: 0,
    };

    // Emails about a form or contract follow that record's enrollment.
    const communications = await db.cfCommunication.findMany({
      where: { ...scope, AND: [{ OR: noEnrollment }, { OR: [{ formAssignmentId: { not: null } }, { contractId: { not: null } }] }] },
      select: { id: true, enrollmentId: true, formAssignmentId: true, contractId: true },
    });
    if (communications.length) {
      const [forms, contracts] = await Promise.all([
        db.cfFormAssignment.findMany({
          where: { ...scope, id: { in: communications.map((c) => c.formAssignmentId).filter((id): id is string => Boolean(id)) } },
          select: { id: true, enrollmentId: true },
        }),
        db.cfContract.findMany({
          where: { ...scope, id: { in: communications.map((c) => c.contractId).filter((id): id is string => Boolean(id)) } },
          select: { id: true, enrollmentId: true },
        }),
      ]);
      const enrollmentOf = new Map([...forms, ...contracts].map((row) => [row.id, row.enrollmentId]));
      for (const communication of communications) {
        const enrollmentId = enrollmentOf.get(communication.formAssignmentId ?? '') ?? enrollmentOf.get(communication.contractId ?? '');
        if (!enrollmentId || !enrollmentIds.has(enrollmentId) || enrollmentId === communication.enrollmentId) continue;
        linked.communications += 1;
        if (apply) await db.cfCommunication.updateMany({ where: { ...scope, id: communication.id }, data: { enrollmentId } });
      }
    }
    return linked;
  }

  /** Client ids referenced by client-owned tables with no client row, and their rows. */
  private async orphans(db: TenantDb, organizationId: string, apply: boolean) {
    const scope = { organizationId };
    const models = [...new Set(CLIENT_DELETION_STEPS.filter((step) => step.by === 'clientId' && !step.column).map((step) => step.model))];
    const referenced = new Set<string>();
    for (const model of models) {
      const rows = await (db as unknown as Record<string, Delegate>)[model].findMany({ where: scope, select: { clientId: true }, distinct: ['clientId'] });
      rows.forEach((row) => referenced.add(String(row.clientId)));
    }
    if (!referenced.size) return { clientIds: 0, rows: {} };
    const existing = new Set((await db.cfClient.findMany({ where: { ...scope, id: { in: [...referenced] } }, select: { id: true } })).map((client) => client.id));
    const missing = [...referenced].filter((id) => !existing.has(id));
    const rows: Record<string, number> = {};
    if (!missing.length) return { clientIds: 0, rows };
    if (apply) {
      for (const clientId of missing) {
        const { counts } = await deleteClientOwnedRows(db, organizationId, clientId);
        for (const [model, count] of Object.entries(counts)) rows[model] = (rows[model] ?? 0) + count;
      }
    } else {
      for (const model of models) {
        const count = (await (db as unknown as Record<string, Delegate>)[model].findMany({ where: { ...scope, clientId: { in: missing } }, select: { clientId: true } })).length;
        if (count) rows[model] = count;
      }
    }
    return { clientIds: missing.length, rows };
  }
}
