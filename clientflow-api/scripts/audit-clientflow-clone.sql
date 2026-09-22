-- Read-only clone parity audit. Run this file separately against the legacy source
-- and the point-in-time clone, save both outputs, and diff them. It emits only
-- row counts, deterministic ID fingerprints, and orphan counts; no PII.
--
-- Example (use rotated credentials supplied outside shell history):
--   psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -f scripts/audit-clientflow-clone.sql

\pset pager off
\pset format unaligned
\pset fieldsep '|'

SELECT 'database_schema' AS section,
       current_schema() AS name,
       current_database() AS value;

SELECT format(
  'SELECT %L AS section, %L AS name, count(*)::text || %L || coalesce(md5(string_agg(%I::text, %L ORDER BY %I::text)), md5(%L)) AS value FROM %I.%I;',
  'table',
  table_name,
  '|',
  'id',
  ',',
  'id',
  '',
  table_schema,
  table_name
)
FROM information_schema.columns
WHERE table_schema = current_schema()
  AND column_name = 'id'
  AND (table_name LIKE 'Cf%' OR table_name IN ('Organization', 'AdminUser'))
ORDER BY table_name
\gexec

SELECT 'migrations' AS section,
       '_prisma_migrations' AS name,
       count(*)::text || '|' || coalesce(
         md5(string_agg(migration_name || ':' || checksum, ',' ORDER BY migration_name)),
         md5('')
       ) AS value
FROM "_prisma_migrations";

SELECT 'orphan' AS section, 'CfClient.organizationId' AS name, count(*)::text AS value
FROM "CfClient" child
LEFT JOIN "Organization" parent ON parent.id = child."organizationId"
WHERE parent.id IS NULL;

SELECT 'orphan' AS section, 'CfFormTemplate.organizationId' AS name, count(*)::text AS value
FROM "CfFormTemplate" child
LEFT JOIN "Organization" parent ON parent.id = child."organizationId"
WHERE parent.id IS NULL;

SELECT 'orphan' AS section, 'CfFormAssignment.clientId' AS name, count(*)::text AS value
FROM "CfFormAssignment" child
LEFT JOIN "CfClient" parent
  ON parent.id = child."clientId" AND parent."organizationId" = child."organizationId"
WHERE parent.id IS NULL;

SELECT 'orphan' AS section, 'CfFormAssignment.formId' AS name, count(*)::text AS value
FROM "CfFormAssignment" child
LEFT JOIN "CfFormTemplate" parent
  ON parent.id = child."formId" AND parent."organizationId" = child."organizationId"
WHERE parent.id IS NULL;

SELECT 'orphan' AS section, 'CfActivityLog.clientId' AS name, count(*)::text AS value
FROM "CfActivityLog" child
LEFT JOIN "CfClient" parent
  ON parent.id = child."clientId" AND parent."organizationId" = child."organizationId"
WHERE parent.id IS NULL;

SELECT 'orphan' AS section, 'CfContract.clientId' AS name, count(*)::text AS value
FROM "CfContract" child
LEFT JOIN "CfClient" parent
  ON parent.id = child."clientId" AND parent."organizationId" = child."organizationId"
WHERE parent.id IS NULL;

SELECT 'orphan' AS section, 'CfContract.programId' AS name, count(*)::text AS value
FROM "CfContract" child
LEFT JOIN "CfProgram" parent
  ON parent.id = child."programId" AND parent."organizationId" = child."organizationId"
WHERE parent.id IS NULL;

SELECT 'SELECT ''orphan'' AS section, ''CfContract.contractTemplateId'' AS name, count(*)::text AS value
FROM "CfContract" child
LEFT JOIN "CfContractTemplate" parent
  ON parent.id = child."contractTemplateId" AND parent."organizationId" = child."organizationId"
WHERE parent.id IS NULL;'
WHERE EXISTS (
  SELECT 1 FROM information_schema.columns
  WHERE table_schema = current_schema()
    AND table_name = 'CfContract'
    AND column_name = 'contractTemplateId'
)
\gexec

SELECT 'SELECT ''orphan'' AS section, ''CfCommunication.contractId'' AS name, count(*)::text AS value
FROM "CfCommunication" child
LEFT JOIN "CfContract" parent
  ON parent.id = child."contractId" AND parent."organizationId" = child."organizationId"
WHERE child."contractId" IS NOT NULL AND parent.id IS NULL;'
WHERE EXISTS (
  SELECT 1 FROM information_schema.columns
  WHERE table_schema = current_schema()
    AND table_name = 'CfCommunication'
    AND column_name = 'contractId'
)
\gexec

SELECT 'SELECT ''contract_event'' AS section, coalesce("status", ''unset'') AS name, count(*)::text AS value
FROM "CfCommunication"
WHERE "contractId" IS NOT NULL
GROUP BY coalesce("status", ''unset'')
ORDER BY name;'
WHERE EXISTS (
  SELECT 1 FROM information_schema.columns
  WHERE table_schema = current_schema()
    AND table_name = 'CfCommunication'
    AND column_name = 'contractId'
)
\gexec

SELECT 'SELECT ''orphan'' AS section, ''CfMonitoringTask.clientId'' AS name, count(*)::text AS value
FROM "CfMonitoringTask" child
LEFT JOIN "CfClient" parent
  ON parent.id = child."clientId" AND parent."organizationId" = child."organizationId"
WHERE parent.id IS NULL;'
WHERE EXISTS (
  SELECT 1 FROM information_schema.tables
  WHERE table_schema = current_schema() AND table_name = 'CfMonitoringTask'
)
\gexec

SELECT 'SELECT ''orphan'' AS section, ''CfMonitoringTask.programId'' AS name, count(*)::text AS value
FROM "CfMonitoringTask" child
LEFT JOIN "CfProgram" parent
  ON parent.id = child."programId" AND parent."organizationId" = child."organizationId"
WHERE parent.id IS NULL;'
WHERE EXISTS (
  SELECT 1 FROM information_schema.tables
  WHERE table_schema = current_schema() AND table_name = 'CfMonitoringTask'
)
\gexec

SELECT 'SELECT ''orphan'' AS section, ''CfMonitoringTask.contractId'' AS name, count(*)::text AS value
FROM "CfMonitoringTask" child
LEFT JOIN "CfContract" parent
  ON parent.id = child."contractId" AND parent."organizationId" = child."organizationId"
WHERE parent.id IS NULL;'
WHERE EXISTS (
  SELECT 1 FROM information_schema.tables
  WHERE table_schema = current_schema() AND table_name = 'CfMonitoringTask'
)
\gexec

SELECT 'SELECT ''contract_acceptance'' AS section, "status" AS name, count(*)::text AS value
FROM "CfContract"
WHERE "completedAt" IS NOT NULL
GROUP BY "status"
ORDER BY "status";'
WHERE EXISTS (
  SELECT 1 FROM information_schema.columns
  WHERE table_schema = current_schema()
    AND table_name = 'CfContract'
    AND column_name = 'agreedToTerms'
)
\gexec
