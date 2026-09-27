SELECT
  "clientId",
  status,
  details,
  "createdAt"
FROM "CfProgramAutomationExecution"
WHERE "programId" = 'prog-inspired-detroit'
ORDER BY "createdAt" DESC
LIMIT 5;
