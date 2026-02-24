"use server";

import { prisma } from "@el-dorado/db";
import { redirect } from "next/navigation";
import { startOfDayYmdApp } from "@/lib/time";

function parseIntStrict(value: FormDataEntryValue | null): number {
  const str = String(value ?? "").trim();
  if (!str) throw new Error("missing");
  const num = Number(str);
  if (!Number.isFinite(num) || !Number.isInteger(num)) throw new Error("invalid");
  return num;
}

function parseFloatStrict(value: FormDataEntryValue | null): number {
  const str = String(value ?? "").trim();
  if (!str) throw new Error("missing");
  const num = Number(str);
  if (!Number.isFinite(num)) throw new Error("invalid");
  return num;
}

export async function upsertWeeklyDepositResultAction(formData: FormData) {
  try {
    const weekStartStr = String(formData.get("weekStart") ?? "").trim();
    const bucket = String(formData.get("bucket") ?? "").trim();
    const tierRaw = String(formData.get("tier") ?? "").trim() || null;
    const campaignIdRaw = String(formData.get("campaignId") ?? "").trim() || null;

    const depositors = parseIntStrict(formData.get("depositors"));
    const depositsUsd = parseFloatStrict(formData.get("depositsUsd"));
    const notes = String(formData.get("notes") ?? "").trim() || null;

    if (depositors < 0 || depositors > 100000) throw new Error("invalid depositors");
    if (depositsUsd < 0 || depositsUsd > 1_000_000_000) throw new Error("invalid deposits");

    const weekStart = startOfDayYmdApp(weekStartStr);

    const tier = bucket === "tier" ? tierRaw : null;
    const campaignId = bucket === "campaign" ? campaignIdRaw : null;

    if (bucket !== "tier" && bucket !== "campaign") throw new Error("invalid bucket");
    if (bucket === "tier" && !tier) throw new Error("missing tier");
    if (bucket === "campaign" && !campaignId) throw new Error("missing campaign");
    if (bucket === "tier" && campaignId) throw new Error("tier + campaign not allowed");
    if (bucket === "campaign" && tier) throw new Error("tier + campaign not allowed");

    const existing = await prisma.weeklyDepositResult.findFirst({
      where: { weekStart, tier, campaignId },
      select: { id: true },
    });

    if (existing) {
      await prisma.weeklyDepositResult.update({
        where: { id: existing.id },
        data: { depositors, depositsUsd, notes },
        select: { id: true },
      });
    } else {
      await prisma.weeklyDepositResult.create({
        data: { weekStart, tier, campaignId, depositors, depositsUsd, notes },
        select: { id: true },
      });
    }
  } catch {
    // ignore, show best-effort UI
  }

  redirect("/reports");
}

