import { prisma, Prisma, XHandledItemStatus, XHandledItemType } from "@el-dorado/db";

function clampErrorMessage(message: string, max = 900): string {
  const t = String(message ?? "").replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return t.slice(0, max - 1).trimEnd() + "…";
}

export async function reserveHandledItem(args: {
  type: XHandledItemType;
  externalId: string;
  retryErroredAfterMs?: number;
}): Promise<boolean> {
  const retryAfterMs = args.retryErroredAfterMs ?? 6 * 60 * 60 * 1000;
  try {
    await prisma.xHandledItem.create({
      data: {
        type: args.type,
        externalId: args.externalId,
        status: XHandledItemStatus.reserved,
      },
      select: { id: true },
    });
    return true;
  } catch (err) {
    if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== "P2002") throw err;

    const existing = await prisma.xHandledItem.findUnique({
      where: {
        type_externalId: { type: args.type, externalId: args.externalId },
      },
      select: { status: true, updatedAt: true },
    });
    if (!existing) return false;
    if (existing.status !== XHandledItemStatus.error) return false;

    const ageMs = Date.now() - existing.updatedAt.getTime();
    if (ageMs < retryAfterMs) return false;

    await prisma.xHandledItem.update({
      where: {
        type_externalId: { type: args.type, externalId: args.externalId },
      },
      data: { status: XHandledItemStatus.reserved, lastError: null },
      select: { id: true },
    });
    return true;
  }
}

export async function markHandledItemDone(args: { type: XHandledItemType; externalId: string }) {
  await prisma.xHandledItem.update({
    where: { type_externalId: { type: args.type, externalId: args.externalId } },
    data: { status: XHandledItemStatus.done, lastError: null },
    select: { id: true },
  });
}

export async function markHandledItemError(args: { type: XHandledItemType; externalId: string; error: unknown }) {
  const message = args.error instanceof Error ? args.error.message : String(args.error);
  await prisma.xHandledItem.update({
    where: { type_externalId: { type: args.type, externalId: args.externalId } },
    data: { status: XHandledItemStatus.error, lastError: clampErrorMessage(message) },
    select: { id: true },
  });
}
