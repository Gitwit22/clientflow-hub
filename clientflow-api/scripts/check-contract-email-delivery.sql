SELECT
  c."clientId",
  c.type,
  c.channel,
  c.provider,
  c.status,
  c."errorCode",
  c."requestedAt",
  c."sentAt",
  c."recipientEmail",
  c.notes
FROM "CfCommunication" c
JOIN "CfClient" cl ON cl.id = c."clientId"
WHERE cl."businessName" = 'All Encompass Logistics'
ORDER BY c."requestedAt" DESC
LIMIT 5;
