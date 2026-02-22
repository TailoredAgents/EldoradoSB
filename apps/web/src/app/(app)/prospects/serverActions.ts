"use server";

import { prisma } from "@el-dorado/db";
import { ProspectStatus } from "@el-dorado/db";
import { OutreachChannel } from "@el-dorado/db";
import { revalidatePath } from "next/cache";

function requireString(value: FormDataEntryValue | null, name: string): string {
  const str = String(value ?? "").trim();
  if (!str) throw new Error(`Missing ${name}`);
  return str;
}

export async function updateProspectStatusAction(formData: FormData) {
  const id = requireString(formData.get("id"), "id");
  const statusRaw = requireString(formData.get("status"), "status");
  const status = statusRaw as ProspectStatus;

  if (!Object.values(ProspectStatus).includes(status)) {
    throw new Error("Invalid status");
  }

  await prisma.prospect.update({
    where: { id },
    data: { status },
  });

  revalidatePath("/outreach-today");
  revalidatePath("/prospects");
  revalidatePath(`/prospects/${id}`);
}

export async function updateProspectOwnerAction(formData: FormData) {
  const id = requireString(formData.get("id"), "id");
  const owner = String(formData.get("owner") ?? "").trim() || null;

  await prisma.prospect.update({
    where: { id },
    data: { owner },
  });

  revalidatePath("/outreach-today");
  revalidatePath("/prospects");
  revalidatePath(`/prospects/${id}`);
}

export async function updateProspectNotesAction(formData: FormData) {
  const id = requireString(formData.get("id"), "id");
  const notes = String(formData.get("notes") ?? "").trim() || null;

  await prisma.prospect.update({
    where: { id },
    data: { notes },
  });

  revalidatePath(`/prospects/${id}`);
}

export async function addOutreachEventAction(formData: FormData) {
  const prospectId = requireString(formData.get("prospectId"), "prospectId");
  const channelRaw = requireString(formData.get("channel"), "channel");
  const channel = channelRaw as OutreachChannel;
  if (!Object.values(OutreachChannel).includes(channel)) {
    throw new Error("Invalid channel");
  }
  const eventType = requireString(formData.get("eventType"), "eventType");
  const outcome = String(formData.get("outcome") ?? "").trim() || null;
  const notes = String(formData.get("notes") ?? "").trim() || null;

  const followUpAtRaw = String(formData.get("followUpAt") ?? "").trim();
  const followUpAt = followUpAtRaw ? new Date(followUpAtRaw) : null;

  const depositorsRaw = String(formData.get("depositors") ?? "").trim();
  const depositsUsdRaw = String(formData.get("depositsUsd") ?? "").trim();

  const depositors =
    depositorsRaw === "" ? null : Number.isFinite(Number(depositorsRaw)) ? Number(depositorsRaw) : null;
  const depositsUsd =
    depositsUsdRaw === "" ? null : Number.isFinite(Number(depositsUsdRaw)) ? Number(depositsUsdRaw) : null;

  await prisma.outreachEvent.create({
    data: {
      prospectId,
      channel,
      eventType,
      outcome,
      followUpAt,
      notes,
      depositors: depositors == null ? null : Math.max(0, Math.floor(depositors)),
      depositsUsd: depositsUsd == null ? null : Math.max(0, depositsUsd),
    },
  });

  // Lightweight status auto-advance based on common event types.
  const statusMap: Record<string, ProspectStatus> = {
    queued: ProspectStatus.queued,
    contacted: ProspectStatus.contacted,
    replied: ProspectStatus.replied,
    negotiating: ProspectStatus.negotiating,
    signed: ProspectStatus.signed,
    rejected: ProspectStatus.rejected,
    dnc: ProspectStatus.dnc,
    done: ProspectStatus.done,
  };

  const nextStatus = statusMap[eventType.toLowerCase()];
  if (nextStatus) {
    await prisma.prospect.update({
      where: { id: prospectId },
      data: { status: nextStatus },
    });
  }

  revalidatePath("/outreach-today");
  revalidatePath("/prospects");
  revalidatePath(`/prospects/${prospectId}`);
}
