"use server";

import { prisma } from "@el-dorado/db";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

function parseIntStrict(value: FormDataEntryValue | null): number {
  const str = String(value ?? "").trim();
  if (!str) throw new Error("missing");
  const num = Number(str);
  if (!Number.isFinite(num) || !Number.isInteger(num)) throw new Error("invalid");
  return num;
}

export async function updateSettingsAction(formData: FormData) {
  try {
    const enabled = formData.get("enabled") === "on";
    const maxPostReadsPerRun = parseIntStrict(formData.get("maxPostReadsPerRun"));
    const maxPostReadsPerDay = parseIntStrict(formData.get("maxPostReadsPerDay"));
    const prospectPipelineEnabled = formData.get("prospectPipelineEnabled") === "on";
    const maxProspectPipelinePostReadsPerRun = parseIntStrict(formData.get("maxProspectPipelinePostReadsPerRun"));
    const queueValueCount = parseIntStrict(formData.get("queueValueCount"));
    const queueAcceptanceCount = parseIntStrict(formData.get("queueAcceptanceCount"));
    const queueExplorationCount = parseIntStrict(formData.get("queueExplorationCount"));
    const disclaimerText = String(formData.get("disclaimerText") ?? "").trim() || null;

    if (
      maxPostReadsPerRun < 1 ||
      maxPostReadsPerDay < 1 ||
      maxProspectPipelinePostReadsPerRun < 0 ||
      maxProspectPipelinePostReadsPerRun > 200 ||
      queueValueCount < 0 ||
      queueAcceptanceCount < 0 ||
      queueExplorationCount < 0
    ) {
      throw new Error("invalid");
    }

    await prisma.settings.upsert({
      where: { id: 1 },
      update: {
        enabled,
        maxPostReadsPerRun,
        maxPostReadsPerDay,
        prospectPipelineEnabled,
        maxProspectPipelinePostReadsPerRun,
        queueValueCount,
        queueAcceptanceCount,
        queueExplorationCount,
        disclaimerText,
      },
      create: {
        id: 1,
        enabled,
        maxPostReadsPerRun,
        maxPostReadsPerDay,
        prospectPipelineEnabled,
        maxProspectPipelinePostReadsPerRun,
        queueValueCount,
        queueAcceptanceCount,
        queueExplorationCount,
        disclaimerText,
      },
    });

    revalidatePath("/settings");
    redirect("/settings?ok=1");
  } catch {
    redirect("/settings?error=1");
  }
}

