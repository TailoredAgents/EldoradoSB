import { prisma } from "@el-dorado/db";

export async function reserveHandledItem(args: {
  platform: string;
  type: string;
  externalId: string;
  retryErroredAfterMs?: number;
}) {
  const now = Date.now();
  const retryAfter = args.retryErroredAfterMs ? new Date(now - args.retryErroredAfterMs) : null;

  try {
    await prisma.handledItem.create({
      data: {
        platform: args.platform,
        type: args.type,
        externalId: args.externalId,
        status: "reserved",
      },
      select: { id: true },
    });
    return true;
  } catch {
    // Existing row. If it errored and is old enough, re-reserve it.
  }

  const existing = await prisma.handledItem.findUnique({
    where: { platform_type_externalId: { platform: args.platform, type: args.type, externalId: args.externalId } },
    select: { status: true, updatedAt: true },
  });
  if (!existing) return false;

  if (existing.status !== "error") return false;
  if (retryAfter && existing.updatedAt < retryAfter) {
    await prisma.handledItem.update({
      where: { platform_type_externalId: { platform: args.platform, type: args.type, externalId: args.externalId } },
      data: { status: "reserved", lastError: null },
      select: { id: true },
    });
    return true;
  }

  return false;
}

export async function markHandledItemDone(args: { platform: string; type: string; externalId: string }) {
  await prisma.handledItem.update({
    where: { platform_type_externalId: { platform: args.platform, type: args.type, externalId: args.externalId } },
    data: { status: "done" },
    select: { id: true },
  });
}

export async function markHandledItemError(args: {
  platform: string;
  type: string;
  externalId: string;
  error: unknown;
}) {
  const message = args.error instanceof Error ? args.error.message : String(args.error);
  await prisma.handledItem.update({
    where: { platform_type_externalId: { platform: args.platform, type: args.type, externalId: args.externalId } },
    data: { status: "error", lastError: message.slice(0, 500) },
    select: { id: true },
  });
}

