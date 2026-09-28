import type { StorageService } from '../../integrations/storage/storage.service';
import type { PrismaService } from '../../prisma/prisma.service';
import { renderExecutedContractPdf, type ExecutedContractAcceptance } from './executed-contract-pdf';

export const EXECUTED_CONTRACT_MIME_TYPE = 'application/pdf';

export function executedContractObjectKey(organizationId: string, clientId: string, contractId: string): string {
  return `contracts/${organizationId}/${clientId}/${contractId}-executed.pdf`;
}

/** The file name the client and staff see when they download the signed copy. */
export function executedCopyFileName(businessName: string | null | undefined, contractType: string): string {
  const name = [businessName?.trim(), contractType.trim(), 'Signed']
    .filter(Boolean)
    .join(' - ')
    .split('')
    .filter((char) => char.charCodeAt(0) >= 0x20)
    .join('')
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return `${name.slice(0, 150)}.pdf`;
}

export function renderExecutedContract(
  contract: { contractType: string; generatedContent: string },
  acceptance: ExecutedContractAcceptance | null,
): Promise<Buffer> {
  return renderExecutedContractPdf({
    title: contract.contractType,
    body: contract.generatedContent,
    acceptance: acceptance ?? undefined,
  });
}

export interface ExecutedContractRecord {
  id: string;
  organizationId: string;
  clientId: string;
  contractType: string;
  generatedContent: string;
  signedName: string | null;
  signedEmail: string | null;
  signedAt: Date | null;
  completedAt: Date | null;
  signatureNote: string | null;
}

export interface ExecutedStoredFile {
  id: string;
  storageKey: string;
  mimeType: string;
  uploadedByUserId: string | null;
  completedAt: Date | null;
}

export const EXECUTED_STORED_FILE_SELECT = {
  id: true,
  storageKey: true,
  mimeType: true,
  uploadedByUserId: true,
  completedAt: true,
} as const;

/**
 * Returns the executed copy's storage key, first upgrading a copy archived as plain text (before
 * copies were PDFs) to a PDF. The PDF is rebuilt from the contract record, which holds the same
 * content and acceptance details the text file was made from.
 */
export async function ensureExecutedContractPdf(
  prisma: PrismaService,
  storage: StorageService,
  contract: ExecutedContractRecord,
  storedFile: ExecutedStoredFile,
  businessName: string | null | undefined,
): Promise<{ storageKey: string; downloadFileName: string }> {
  const downloadFileName = executedCopyFileName(businessName, contract.contractType);
  if (storedFile.mimeType === EXECUTED_CONTRACT_MIME_TYPE) {
    return { storageKey: storedFile.storageKey, downloadFileName };
  }

  const signedAt = contract.signedAt ?? contract.completedAt;
  const pdf = await renderExecutedContract(
    contract,
    contract.signedName && signedAt
      ? {
          signedName: contract.signedName,
          signedEmail: contract.signedEmail ?? '',
          signedAt,
          note: contract.signatureNote,
        }
      : null,
  );
  const uploaded = await storage.uploadBuffer(
    executedContractObjectKey(contract.organizationId, contract.clientId, contract.id),
    pdf,
    EXECUTED_CONTRACT_MIME_TYPE,
    downloadFileName,
  );

  const pdfFile = await prisma.cfStoredFile.upsert({
    where: { storageKey: uploaded.objectKey },
    update: { sizeBytes: uploaded.byteSize, mimeType: EXECUTED_CONTRACT_MIME_TYPE, status: 'READY' },
    create: {
      organizationId: contract.organizationId,
      storageKey: uploaded.objectKey,
      originalFileName: `${contract.contractType} - Executed.pdf`,
      mimeType: EXECUTED_CONTRACT_MIME_TYPE,
      sizeBytes: uploaded.byteSize,
      status: 'READY',
      uploadedByUserId: storedFile.uploadedByUserId,
      completedAt: storedFile.completedAt ?? signedAt ?? new Date(),
    },
  });
  await prisma.$transaction([
    prisma.cfContract.update({ where: { id: contract.id }, data: { executedStoredFileId: pdfFile.id } }),
    // The client's Documents entry follows the new file.
    prisma.cfDocument.updateMany({
      where: { organizationId: contract.organizationId, storedFileId: storedFile.id },
      data: {
        storedFileId: pdfFile.id,
        objectKey: uploaded.objectKey,
        url: uploaded.url,
        bucket: uploaded.bucket,
        byteSize: uploaded.byteSize,
      },
    }),
  ]);
  return { storageKey: uploaded.objectKey, downloadFileName };
}
