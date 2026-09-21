-- Read-only clone parity audit. Run this file separately against the API 2 source
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
