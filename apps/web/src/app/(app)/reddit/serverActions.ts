"use server";

import { redirect } from "next/navigation";
import { prisma, Prisma } from "@el-dorado/db";
import { requireAuth } from "@/lib/auth";

function parseIntStrict(value: FormDataEntryValue | null): number {
  const str = String(value ?? "").trim();
  if (!str) throw new Error("missing");
  const num = Number(str);
  if (!Number.isFinite(num) || !Number.isInteger(num)) throw new Error("invalid");
  return num;
}

function parseText(value: FormDataEntryValue | null): string {
  return String(value ?? "").trim();
}

function parseLines(value: FormDataEntryValue | null): string[] {
  const raw = String(value ?? "");
  return raw
    .split(/\r?\n/g)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => l.replace(/^r\//, ""));
}

export async function updateRedditSettingsAction(formData: FormData) {
  await requireAuth();

  try {
    const enabled = formData.get("enabled") === "on";
    const outboundEnabled = formData.get("outboundEnabled") === "on";
    const inboundEnabled = formData.get("inboundEnabled") === "on";
    const maxCommentsPerDay = parseIntStrict(formData.get("maxCommentsPerDay"));
    const maxCommentsPerRun = parseIntStrict(formData.get("maxCommentsPerRun"));
    const ctaPercent = parseIntStrict(formData.get("ctaPercent"));

    if (
      maxCommentsPerDay < 0 ||
      maxCommentsPerDay > 200 ||
      maxCommentsPerRun < 0 ||
      maxCommentsPerRun > 50 ||
      ctaPercent < 0 ||
      ctaPercent > 100
    ) {
      throw new Error("invalid caps");
    }

    const subs = parseLines(formData.get("subreddits"));
    const allowCta = new Set(parseLines(formData.get("ctaAllowedSubreddits")));
    const xHandle = parseText(formData.get("xHandle")) || "EldoradoSB";

    const config = {
      xHandle,
      subreddits: subs.map((name) => ({ name, allowCta: allowCta.has(name) })),
    } as Prisma.InputJsonValue;

    await prisma.redditAccountSettings.upsert({
      where: { id: 1 },
      update: {
        enabled,
        outboundEnabled,
        inboundEnabled,
        maxCommentsPerDay,
        maxCommentsPerRun,
        ctaPercent,
        config,
      },
      create: {
        id: 1,
        enabled,
        outboundEnabled,
        inboundEnabled,
        maxCommentsPerDay,
        maxCommentsPerRun,
        ctaPercent,
        config,
      },
    });

    redirect("/reddit?ok=1");
  } catch {
    redirect("/reddit?error=1");
  }
}
