SELECT
  p.id AS "programId",
  p.name AS "programName",
  wc.enabled,
  wc."sendContractAfterIntake",
  wc."sendWelcomeAfterContractSigned",
  wc."activeContractTemplateId",
  ct.name AS "activeContractTemplateName",
  wc."activeContractVersionId",
  cv.title AS "activeContractVersionTitle",
  wc."activeWelcomeEmailTemplateId",
  wc."activeWelcomeEmailVersionId"
FROM "CfProgram" p
LEFT JOIN "CfProgramWorkflowConfig" wc ON wc."programId" = p.id
LEFT JOIN "CfProgramContractTemplate" ct ON ct.id = wc."activeContractTemplateId"
LEFT JOIN "CfProgramContractVersion" cv ON cv.id = wc."activeContractVersionId"
WHERE p.id = 'prog-inspired-detroit';
