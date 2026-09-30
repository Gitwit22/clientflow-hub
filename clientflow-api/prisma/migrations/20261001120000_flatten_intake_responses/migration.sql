-- Intake answers were stored on the form assignment as { core, programs, selectedProgramIds }.
-- Everything that reads them ("Apply to profile", the Forms card) expects the core answers keyed
-- by field id at the top level; program answers already live in CfIntakeSubmissionProgram.
-- Idempotent: only rows still in the nested shape are rewritten.
UPDATE "CfFormAssignment"
SET "responses" = "responses" -> 'core'
WHERE jsonb_typeof("responses") = 'object'
  AND jsonb_typeof("responses" -> 'core') = 'object'
  AND "responses" ?& ARRAY['core', 'programs'];
