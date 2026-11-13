-- Stored files: which bucket holds each file. Additive only.
-- Null (every existing row) means the private bucket, which is where all files lived until now.
-- Only the header logo and email images use 'public', a separate publicly readable bucket, so
-- contracts and client documents can stay private.

-- AlterTable
ALTER TABLE "CfStoredFile" ADD COLUMN "storageBucket" TEXT;

-- Client documents and executed contracts are private and are only ever served through short-lived
-- signed links (documents/:id/download uses the stored file, never this column). Older rows kept a
-- public R2 link here; blank those so no permanent link to a private file stays in the database or
-- in API responses. Other values (none are R2 links) are left untouched.
UPDATE "CfDocument"
SET "url" = ''
WHERE "url" LIKE 'https://pub-%.r2.dev/%'
   OR "url" LIKE 'https://%.r2.cloudflarestorage.com/%';
