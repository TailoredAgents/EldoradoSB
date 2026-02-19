import { prisma } from "@el-dorado/db";

export type QueryYieldStat = {
  queryId: string;
  discovered: number;
  queued: number;
  signed: number;
  score: number;
};

function daysAgoUtc(days: number): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d;
}

export async function getQueryYieldStats(args: { lookbackDays: number }): Promise<Map<string, QueryYieldStat>> {
  const since = daysAgoUtc(args.lookbackDays);

  const discovered = await prisma.prospect.groupBy({
    by: ["firstDiscoveredQueryId"],
    where: { firstDiscoveredQueryId: { not: null }, firstDiscoveredAt: { gte: since } },
    _count: { id: true },
  });

  const queued = await prisma.prospect.groupBy({
    by: ["firstDiscoveredQueryId"],
    where: {
      firstDiscoveredQueryId: { not: null },
      firstDiscoveredAt: { gte: since },
      queuedAt: { not: null },
    },
    _count: { id: true },
  });

  const signed = await prisma.prospect.groupBy({
    by: ["firstDiscoveredQueryId"],
    where: {
      firstDiscoveredQueryId: { not: null },
      firstDiscoveredAt: { gte: since },
      status: "signed",
    },
    _count: { id: true },
  });

  const discoveredMap = new Map<string, number>();
  for (const row of discovered) discoveredMap.set(row.firstDiscoveredQueryId!, row._count.id);

  const queuedMap = new Map<string, number>();
  for (const row of queued) queuedMap.set(row.firstDiscoveredQueryId!, row._count.id);

  const signedMap = new Map<string, number>();
  for (const row of signed) signedMap.set(row.firstDiscoveredQueryId!, row._count.id);

  const allIds = new Set<string>([
    ...discoveredMap.keys(),
    ...queuedMap.keys(),
    ...signedMap.keys(),
  ]);

  const out = new Map<string, QueryYieldStat>();
  for (const queryId of allIds) {
    const d = discoveredMap.get(queryId) ?? 0;
    const q = queuedMap.get(queryId) ?? 0;
    const s = signedMap.get(queryId) ?? 0;

    // Conservative score until we have lots of signed outcomes.
    // Emphasize queued rate heavily; signed rate adds lift.
    const queuedRate = d > 0 ? q / d : 0;
    const signedRate = d > 0 ? s / d : 0;
    const score = queuedRate * 0.85 + signedRate * 0.15;

    out.set(queryId, {
      queryId,
      discovered: d,
      queued: q,
      signed: s,
      score,
    });
  }

  return out;
}

