import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { Prisma } from '../../generated/clientflow';
import type { PrismaService } from '../../prisma/prisma.service';

/**
 * The only place organization-owned records are looked up by id.
 *
 * Every lookup is scoped to the caller's organization and walks the ownership chain
 * (organization → client → enrollment → contract / monitoring / terms / documents). A record that
 * belongs to another organization is indistinguishable from one that doesn't exist: both throw
 * 404. See docs/ARCHITECTURE_RULES.md.
 */
export type TenantDb = PrismaService | Prisma.TransactionClient;

function requireIds(organizationId: string, id: string, label: string): void {
  if (!organizationId) throw new NotFoundException(`${label} not found.`);
  if (!id || typeof id !== 'string') throw new NotFoundException(`${label} not found.`);
}

export async function findClientForOrg(
  db: TenantDb,
  organizationId: string,
  clientId: string,
  options: { includeArchived?: boolean } = {},
) {
  requireIds(organizationId, clientId, 'Client');
  const client = await db.cfClient.findFirst({
    where: { id: clientId, organizationId, ...(options.includeArchived ? {} : { isArchived: false }) },
  });
  if (!client) throw new NotFoundException('Client not found.');
  return client;
}

export async function findProgramForOrg(
  db: TenantDb,
  organizationId: string,
  programId: string,
  options: { activeOnly?: boolean; notFoundMessage?: string } = {},
) {
  requireIds(organizationId, programId, 'Program');
  const program = await db.cfProgram.findFirst({
    where: { id: programId, organizationId, ...(options.activeOnly ? { isActive: true } : {}) },
  });
  if (!program) {
    if (options.notFoundMessage) throw new BadRequestException(options.notFoundMessage);
    throw new NotFoundException('Program not found.');
  }
  return program;
}

export async function findEnrollmentForOrg(
  db: TenantDb,
  organizationId: string,
  enrollmentId: string,
  options: { clientId?: string } = {},
) {
  requireIds(organizationId, enrollmentId, 'Program enrollment');
  const enrollment = await db.cfProgramEnrollment.findFirst({
    where: { id: enrollmentId, organizationId, ...(options.clientId ? { clientId: options.clientId } : {}) },
  });
  if (!enrollment) throw new NotFoundException('Program enrollment not found.');
  return enrollment;
}

export async function findContractForOrg(
  db: TenantDb,
  organizationId: string,
  contractId: string,
  options: { clientId?: string } = {},
) {
  requireIds(organizationId, contractId, 'Contract');
  const contract = await db.cfContract.findFirst({
    where: { id: contractId, organizationId, ...(options.clientId ? { clientId: options.clientId } : {}) },
  });
  if (!contract) throw new NotFoundException('Contract not found.');
  return contract;
}

export async function findFormAssignmentForOrg(
  db: TenantDb,
  organizationId: string,
  assignmentId: string,
  options: { clientId?: string } = {},
) {
  requireIds(organizationId, assignmentId, 'Form assignment');
  const assignment = await db.cfFormAssignment.findFirst({
    where: { id: assignmentId, organizationId, ...(options.clientId ? { clientId: options.clientId } : {}) },
  });
  if (!assignment) throw new NotFoundException('Form assignment not found.');
  return assignment;
}

export async function findFormTemplateForOrg(db: TenantDb, organizationId: string, templateId: string) {
  requireIds(organizationId, templateId, 'Form template');
  const template = await db.cfFormTemplate.findFirst({ where: { id: templateId, organizationId } });
  if (!template) throw new NotFoundException('Form template not found.');
  return template;
}

export async function findMonitoringForOrg(db: TenantDb, organizationId: string, monitoringId: string) {
  requireIds(organizationId, monitoringId, 'Monitoring item');
  const monitoring = await db.cfEnrollmentMonitoring.findFirst({ where: { id: monitoringId, organizationId } });
  if (!monitoring) throw new NotFoundException('Monitoring item not found.');
  return monitoring;
}

export async function findTermsForOrg(db: TenantDb, organizationId: string, termsId: string) {
  requireIds(organizationId, termsId, 'Terms');
  const terms = await db.cfTerms.findFirst({ where: { id: termsId, organizationId } });
  if (!terms) throw new NotFoundException('Terms not found.');
  return terms;
}

export async function findDocumentForOrg(db: TenantDb, organizationId: string, documentId: string) {
  requireIds(organizationId, documentId, 'Document');
  const document = await db.cfDocument.findFirst({ where: { id: documentId, organizationId } });
  if (!document) throw new NotFoundException('Document not found.');
  return document;
}

export async function findStoredFileForOrg(db: TenantDb, organizationId: string, storedFileId: string) {
  requireIds(organizationId, storedFileId, 'File');
  const storedFile = await db.cfStoredFile.findFirst({ where: { id: storedFileId, organizationId } });
  if (!storedFile) throw new NotFoundException('File not found.');
  return storedFile;
}

/**
 * Validates a foreign id supplied in a body or URL before it is written onto another record:
 * the enrollment must belong to the organization and, when given, to the same client.
 */
export async function assertEnrollmentForClient(
  db: TenantDb,
  organizationId: string,
  enrollmentId: string | null | undefined,
  clientId: string,
): Promise<string | null> {
  if (!enrollmentId) return null;
  const enrollment = await findEnrollmentForOrg(db, organizationId, enrollmentId, { clientId });
  return enrollment.id;
}
