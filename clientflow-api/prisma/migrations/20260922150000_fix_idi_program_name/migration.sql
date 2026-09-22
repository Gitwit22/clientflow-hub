-- Corrects a naming mismatch introduced by the previous migration: some organizations already
-- had a program named "The Inspired Detroit Initiative" (e.g. created 2026-08-22), but the seed
-- inserted a duplicate "Inspire Detroit Initiative" row instead of reusing the existing one.

-- Case 1: the org already has "The Inspired Detroit Initiative" — drop the unreferenced duplicate.
DELETE FROM "CfProgram" AS dup
WHERE dup."name" = 'Inspire Detroit Initiative'
  AND EXISTS (
    SELECT 1 FROM "CfProgram" existing
    WHERE existing."organizationId" = dup."organizationId"
      AND existing."name" = 'The Inspired Detroit Initiative'
  )
  AND NOT EXISTS (SELECT 1 FROM "CfClient" WHERE "programId" = dup."id")
  AND NOT EXISTS (SELECT 1 FROM "CfContract" WHERE "programId" = dup."id");

-- Case 2: no pre-existing program for this org — rename the seeded row in place (keeps its id).
UPDATE "CfProgram"
SET "name" = 'The Inspired Detroit Initiative', "updatedAt" = CURRENT_TIMESTAMP
WHERE "name" = 'Inspire Detroit Initiative'
  AND NOT EXISTS (
    SELECT 1 FROM "CfProgram" existing
    WHERE existing."organizationId" = "CfProgram"."organizationId"
      AND existing."name" = 'The Inspired Detroit Initiative'
  );

-- Replace the option's text in place on every master_core intake template (preserves order).
UPDATE "CfFormTemplate"
SET "fields" = (
  SELECT jsonb_agg(
    CASE
      WHEN elem->>'id' <> 'selectedProgram' THEN elem
      ELSE jsonb_set(
        elem,
        '{options}',
        (
          SELECT jsonb_agg(
            CASE WHEN opt = 'Inspire Detroit Initiative'
              THEN to_jsonb('The Inspired Detroit Initiative'::text)
              ELSE to_jsonb(opt)
            END
          )
          FROM jsonb_array_elements_text(elem->'options') AS opt
        )
      )
    END
  )
  FROM jsonb_array_elements("fields") AS elem
)
WHERE "scope" = 'master_core'
  AND "fields" @> '[{"id":"selectedProgram"}]'::jsonb;
