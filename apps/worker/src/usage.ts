import { prisma } from "@el-dorado/db";
import { startOfDayUtc } from "./time";

export async function getTodayUsage() {
  const today = startOfDayUtc(new Date());
  const row = await prisma.usageLedger.findUnique({ where: { date: today } });
  return {
    date: today,
    xPostReads: row?.xPostReads ?? 0,
    xUserLookups: row?.xUserLookups ?? 0,
    estimatedCostUsd: row?.estimatedCostUsd ?? null,
  };
}

export async function incrementTodayUsage(delta: {
  xPostReads?: number;
  xUserLookups?: number;
  estimatedCostUsd?: number;
  llmTokensByModel?: Record<string, number>;
}) {
  const today = startOfDayUtc(new Date());
  const existing = await prisma.usageLedger.findUnique({ where: { date: today } });
  const existingTokens =
    (existing?.llmTokensByModel && typeof existing.llmTokensByModel === "object"
      ? (existing.llmTokensByModel as Record<string, unknown>)
      : {}) ?? {};
  const mergedTokens: Record<string, number> = {};
  for (const [k, v] of Object.entries(existingTokens)) {
    if (typeof v === "number" && Number.isFinite(v)) mergedTokens[k] = v;
  }
  for (const [k, v] of Object.entries(delta.llmTokensByModel ?? {})) {
    if (!Number.isFinite(v)) continue;
    mergedTokens[k] = (mergedTokens[k] ?? 0) + v;
  }

  if (existing) {
    await prisma.usageLedger.update({
      where: { date: today },
      data: {
        xPostReads: { increment: delta.xPostReads ?? 0 },
        xUserLookups: { increment: delta.xUserLookups ?? 0 },
        ...(delta.estimatedCostUsd != null
          ? { estimatedCostUsd: { increment: delta.estimatedCostUsd } }
          : {}),
        ...(Object.keys(delta.llmTokensByModel ?? {}).length
          ? { llmTokensByModel: mergedTokens as any }
          : {}),
      },
    });
    return;
  }

  await prisma.usageLedger.create({
    data: {
      date: today,
      xPostReads: delta.xPostReads ?? 0,
      xUserLookups: delta.xUserLookups ?? 0,
      estimatedCostUsd: delta.estimatedCostUsd ?? null,
      llmTokensByModel: Object.keys(mergedTokens).length ? (mergedTokens as any) : undefined,
    },
  });
}
