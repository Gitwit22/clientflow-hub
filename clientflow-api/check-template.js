const { PrismaClient } = require('./src/generated/clientflow');
const prisma = new PrismaClient();
(async () => {
  const t = await prisma.cfContractTemplate.findMany({ where: { name: 'IDI Membership Agreement' } });
  console.log(JSON.stringify(t.map((x) => ({ id: x.id, organizationId: x.organizationId, name: x.name })), null, 2));
  await prisma.$disconnect();
})().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
