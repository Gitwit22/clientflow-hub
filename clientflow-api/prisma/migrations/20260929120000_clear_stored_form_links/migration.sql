-- Raw public form links are no longer stored: only their SHA-256 hash (secureLinkToken) is kept.
-- Links already emailed keep working because the hash is unchanged; staff get a fresh link on the
-- next send.
UPDATE "CfFormAssignment" SET "secureLink" = NULL WHERE "secureLink" IS NOT NULL;
