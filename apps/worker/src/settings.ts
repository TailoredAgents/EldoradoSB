import { prisma } from "@el-dorado/db";

export async function getOrCreateSettings() {
  return prisma.settings.upsert({
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

