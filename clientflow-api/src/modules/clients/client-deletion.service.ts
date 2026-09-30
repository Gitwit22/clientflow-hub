import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { requireManager, type RoleActor } from '../../common/authorization/role-policy';
import { findClientForOrg, type TenantDb } from '../../common/tenancy/org-scoped.repository';
import { StorageService } from '../../integrations/storage/storage.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CLIENT_DELETION_STEPS, type ClientDataKey, type ClientOwnedModel } from './client-deletion.manifest';

/** The organization-level audit event for a permanent deletion. It never carries the client's details. */
export const CLIENT_PERMANENTLY_DELETED = 'CLIENT_PERMANENTLY_DELETED';
/** Written when files could not be removed from storage after the records were deleted. */
export const STORAGE_CLEANUP = 'storage_cleanup';

type DeleteManyDelegate = { deleteMany(args: { where: Record<string, unknown> }): Promise<{ count: number }> };

export interface PermanentDeletionResult {
  id: string;
  deleted: true;
  /** Rows removed per table (names only, no content). */
  counts: Record<string, number>;
  filesRemoved: number;
  filesFailed: number;
}

/**
 * Permanently erases one client: every row the deletion manifest lists (including billing
 * agreements and payments, so the client's money leaves the reports), the stored files of their
 * contracts and documents, and the client itself. Archiving is the reversible alternative and keeps
 * all of it, money included.
 */
@Injectable()
export class ClientDeletionService {
  private readonly logger = new Logger(ClientDeletionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async permanentlyDelete(input: {
    organizationId: string;
    clientId: string;
    actor: RoleActor;
    /** The business name, typed by staff to confirm. */
    confirmation: string;
  }): Promise<PermanentDeletionResult> {
    requireManager(input.actor);
    const client = await findClientForOrg(this.prisma, input.organizationId, input.clientId, { includeArchived: true });
    if (normalizeName(input.confirmation) !== normalizeName(client.businessName)) {
      throw new BadRequestException('Type the business name exactly as shown to confirm permanent deletion.');
    }

    const { counts, storageKeys } = await this.prisma.$transaction(
      (transaction) => this.deleteRecords(transaction, input.organizationId, client.id, input.actor.id),
      { maxWait: 10_000, timeout: 60_000 },
    );

    // Files go only after the records are gone for good: a failed transaction must leave them.
    const failedKeys = await this.removeFiles(storageKeys);
    if (failedKeys.length) {
      await this.prisma.auditLog.create({
        data: {
          organizationId: input.organizationId,
          actorAdminId: input.actor.id,
          action: 'deleted',
          targetType: STORAGE_CLEANUP,
          targetId: client.id,
          metadata: { failedObjectKeys: failedKeys },
        },
      });
    }

    return {
      id: client.id,
      deleted: true,
      counts,
      filesRemoved: storageKeys.length - failedKeys.length,
      filesFailed: failedKeys.length,
    };
  }

  private async deleteRecords(db: TenantDb, organizationId: string, clientId: string, actorAdminId: string) {
    // Re-read inside the transaction so a concurrent delete can't be applied twice.
    await findClientForOrg(db, organizationId, clientId, { includeArchived: true });
    const scope = { organizationId };
    const { counts, contracts, documents } = await deleteClientOwnedRows(db, organizationId, clientId);

    // Stored files that only this client's contracts and documents used (program templates and
    // welcome guides keep theirs).
    const candidateFileIds = [
      ...new Set([
        ...contracts.map((contract) => contract.executedStoredFileId),
        ...documents.map((document) => document.storedFileId),
      ].filter((id): id is string => Boolean(id))),
    ];
    const storageKeys = new Set(documents.map((document) => document.objectKey).filter((key): key is string => Boolean(key)));
    if (candidateFileIds.length) {
      const stillUsed = new Set([
        ...(await db.cfProgramContractVersion.findMany({
          where: { ...scope, storedFileId: { in: candidateFileIds } },
          select: { storedFileId: true },
        })).map((row) => row.storedFileId),
        ...(await db.cfProgramWelcomeEmailVersion.findMany({
          where: { ...scope, guideStoredFileId: { in: candidateFileIds } },
          select: { guideStoredFileId: true },
        })).map((row) => row.guideStoredFileId),
        ...(await db.cfDocument.findMany({
          where: { ...scope, storedFileId: { in: candidateFileIds } },
          select: { storedFileId: true },
        })).map((row) => row.storedFileId),
        ...(await db.cfContract.findMany({
          where: { ...scope, executedStoredFileId: { in: candidateFileIds } },
          select: { executedStoredFileId: true },
        })).map((row) => row.executedStoredFileId),
      ]);
      const ownFileIds = candidateFileIds.filter((id) => !stillUsed.has(id));
      if (ownFileIds.length) {
        const files = await db.cfStoredFile.findMany({
          where: { ...scope, id: { in: ownFileIds } },
          select: { storageKey: true },
        });
        files.forEach((file) => storageKeys.add(file.storageKey));
        const { count } = await db.cfStoredFile.deleteMany({ where: { ...scope, id: { in: ownFileIds } } });
        if (count) counts.cfStoredFile = count;
      }
    }

    const { count: clientCount } = await db.cfClient.deleteMany({ where: { ...scope, id: clientId } });
    counts.cfClient = clientCount;

    // The one organizational record of the deletion: who, when, which id and row counts. No name,
    // email or other details of the client.
    await db.auditLog.create({
      data: {
        organizationId,
        actorAdminId,
        action: 'deleted',
        targetType: CLIENT_PERMANENTLY_DELETED,
        targetId: clientId,
        metadata: { counts },
      },
    });

    return { counts, storageKeys: [...storageKeys] };
  }

  private async removeFiles(keys: string[]): Promise<string[]> {
    if (!keys.length) return [];
    // Without storage configured the files can't be reached: record them for manual cleanup.
    if (!this.storage.isEnabled()) return keys;
    const failed: string[] = [];
    for (const key of keys) {
      try {
        await this.storage.deleteObject(key);
      } catch (error) {
        this.logger.warn(`Unable to delete stored object after client deletion: ${(error as Error).message}`);
        failed.push(key);
      }
    }
    return failed;
  }
}

function normalizeName(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Deletes every row the manifest lists for one client id, children first, and returns what it
 * removed plus the client's contracts and documents (for their stored files). The client row itself
 * is left to the caller. Also used to clear rows left behind by a client that no longer exists.
 */
export async function deleteClientOwnedRows(db: TenantDb, organizationId: string, clientId: string) {
  const scope = { organizationId };
  const ids = (rows: Array<{ id: string }>) => rows.map((row) => row.id);

  const enrollmentIds = ids(await db.cfProgramEnrollment.findMany({ where: { ...scope, clientId }, select: { id: true } }));
  const formAssignmentIds = ids(await db.cfFormAssignment.findMany({ where: { ...scope, clientId }, select: { id: true } }));
  const intakeSubmissionIds = ids(await db.cfIntakeSubmission.findMany({ where: { ...scope, clientId }, select: { id: true } }));
  const billingAgreementIds = enrollmentIds.length
    ? ids(await db.cfEnrollmentBillingAgreement.findMany({
        where: { ...scope, enrollmentId: { in: enrollmentIds } },
        select: { id: true },
      }))
    : [];
  const contracts = await db.cfContract.findMany({
    where: { ...scope, clientId },
    select: { id: true, executedStoredFileId: true },
  });
  const documents = await db.cfDocument.findMany({
    where: { ...scope, clientId },
    select: { id: true, storedFileId: true, objectKey: true },
  });

  const idsByKey: Record<ClientDataKey, string[]> = {
    clientId: [clientId],
    enrollmentId: enrollmentIds,
    formAssignmentId: formAssignmentIds,
    intakeSubmissionId: intakeSubmissionIds,
    billingAgreementId: billingAgreementIds,
    anyOwnedId: [
      clientId,
      ...enrollmentIds,
      ...formAssignmentIds,
      ...intakeSubmissionIds,
      ...ids(contracts),
      ...ids(documents),
    ],
  };

  const counts: Record<string, number> = {};
  for (const step of CLIENT_DELETION_STEPS) {
    const values = idsByKey[step.by];
    if (!values.length) continue;
    const delegate = (db as unknown as Record<ClientOwnedModel, DeleteManyDelegate>)[step.model];
    const { count } = await delegate.deleteMany({ where: { ...scope, [step.column ?? step.by]: { in: values } } });
    if (count) counts[step.model] = (counts[step.model] ?? 0) + count;
  }

  return { counts, contracts, documents };
}
