import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  await prisma.settings.upsert({
    where: { id: 1 },
    update: {},
    create: {
      id: 1,
      enabled: true,
      maxPostReadsPerRun: 25,
      maxPostReadsPerDay: 400,
      queueValueCount: 12,
      queueAcceptanceCount: 6,
      queueExplorationCount: 2,
    },
  });
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });

